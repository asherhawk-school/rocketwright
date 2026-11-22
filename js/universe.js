'use strict';
/* Rocketwright — the persistent universe: vessels you leave in flight keep orbiting (or sit landed) in the
   save, move on rails while you're elsewhere, and can be flown again, docked with or rescued. */

const PHYSICS_RANGE = 2400;   // other vessels closer than this are simulated fully and drawn
const UNLOAD_RANGE = 3000;

function universe() {
  const s = Career.s;
  if (!s) return null;
  if (!s.vessels) { s.vessels = []; s.vesselSeq = 1; }
  return s;
}

/* ---------------- serialisation ---------------- */

const PART_KEYS = ['uid', 'id', 'x', 'top', 'bot', 'flip', 'inv', 'links', 'fuel', 'solid', 'mono', 'gas', 'ec', 'ablator', 'ignited', 'result', 'spent', 'sym', 'cfg',
  'shell', 'open', 'area', 'torn', 'inflated', 'brake', 'cellOff', 'gear'];

function serialiseParts(parts) {
  return parts.map((p) => {
    const o = {};
    for (const k of PART_KEYS) if (p[k] !== undefined && p[k] !== null && p[k] !== false) o[k] = p[k];
    o.links = p.links.slice();
    return o;
  });
}
function deserialiseParts(list) {
  return list.filter((o) => PART_DEFS[o.id]).map((o) => ({
    fuel: 0, solid: 0, mono: 0, gas: 0, ec: 0, ablator: 0, ignited: false, flip: false, inv: false, sym: null, shell: false, open: false, area: 0,
    ...JSON.parse(JSON.stringify(o)), def: PART_DEFS[o.id], temp: T_AMBIENT, burn: 0, m: 0,
  }));
}

/* Turn a live craft into a vessel record (state at time t). */
function vesselFromCraft(c, t, meta) {
  return {
    id: meta.id, name: meta.name, crew: (meta.crew || []).map((x) => ({ ...x })), launchT: meta.launchT || t,
    kind: meta.kind || 'ship', flags: meta.flags ? JSON.parse(JSON.stringify(meta.flags)) : { space: false, maxAlt: 0, visited: [], landedOn: [] },
    parts: serialiseParts(c.parts), stages: c.stages.map((s) => s.slice()), stageIdx: c.stageIdx,
    t, s: [c.pos[0], c.pos[1], c.vel[0], c.vel[1]], angle: c.angle, angVel: c.landed ? 0 : c.angVel,
    landed: c.landed ? { body: c.landed.body.id, rx: c.landed.rx, ry: c.landed.ry } : null,
    chuteOpen: c.chuteOpen, chuteArea: c.chuteArea, rcsOn: c.rcsOn, docked: meta.docked || {},
  };
}

/* Build a live craft from a vessel record, at the record's time. */
function craftFromVessel(v) {
  const c = new Craft(deserialiseParts(v.parts), { stages: v.stages.map((s) => s.slice()) });
  c.stageIdx = v.stageIdx || 0;
  c.angle = v.angle;
  c.angVel = v.angVel || 0;
  c.xc = undefined;
  c.recompute();
  c.pos = [v.s[0], v.s[1]];
  c.vel = [v.s[2], v.s[3]];
  if (v.landed) c.landed = { body: BODY_BY_ID[v.landed.body], rx: v.landed.rx, ry: v.landed.ry };
  // saves from before parachutes opened one by one
  if (v.chuteOpen && !c.chutes.some((p) => p.open)) for (const p of c.chutes) { p.open = true; p.area = (v.chuteArea || 0) / c.chutes.length; }
  c.recompute();
  c.rcsOn = !!v.rcsOn;
  c.vid = v.id;
  return c;
}

/* ---------------- rails ---------------- */

/* Move a vessel record forward to time t. Returns false if it was destroyed on the way
   (fell too deep into an atmosphere, hit the ground, or sank into a gas giant or the star). */
function advanceVessel(v, t) {
  if (t <= v.t) return true;
  if (v.angVel) v.angle = wrapPi(v.angle + v.angVel * (t - v.t));
  if (v.landed) {
    const b = BODY_BY_ID[v.landed.body], st = bodyState(b, t);
    v.s = [st[0] + v.landed.rx, st[1] + v.landed.ry, st[2], st[3]];
    v.t = t;
    return true;
  }
  const s = v.s;
  let tt = v.t, b = soiBody(s[0], s[1], tt);
  for (let i = 0; i < 20000 && tt < t - 1e-6; i++) {
    const dt = Math.min(t - tt, stepLimit(b, s[0], s[1], s[2], s[3], tt, 0.003, 2e5));
    rk4Step(b, s, tt, dt);
    tt += dt;
    b = soiBody(s[0], s[1], tt);
    const bp = bodyPos(b, tt);
    const alt = Math.hypot(s[0] - bp[0], s[1] - bp[1]) - b.R;
    const floor = b.star ? b.R * 0.2 : b.gas ? b.atmo.top * 0.5 : b.atmo ? b.atmo.top * 0.5 : groundAlt(b, Math.atan2(s[1] - bp[1], s[0] - bp[0]));
    if (alt < floor) { v.t = tt; v.lostAt = b.id; return false; }
  }
  v.t = t;
  return true;
}

/* Bring every stored vessel up to time t; returns the ones that were lost. */
function advanceAll(t) {
  const s = universe();
  if (!s) return [];
  const lost = [];
  for (const v of s.vessels) if (!advanceVessel(v, t)) lost.push(v);
  if (lost.length) s.vessels = s.vessels.filter((v) => !lost.includes(v));
  return lost;
}

function vesselBody(v) { return v.landed ? BODY_BY_ID[v.landed.body] : soiBody(v.s[0], v.s[1], v.t); }

/* Where a vessel is, in words. */
function vesselSituation(v) {
  const b = vesselBody(v);
  if (v.landed) {
    const st = bodyState(b, v.t);
    const h = terrainH(b, Math.atan2(v.s[1] - st[1], v.s[0] - st[0]));
    return `${b.ocean && h < 0 ? 'Splashed down on' : 'Landed on'} ${b.name}`;
  }
  const o = orbitElements(b, v.s[0], v.s[1], v.s[2], v.s[3], v.t);
  if (o.e >= 1) return `Escaping ${b.name}`;
  if (o.rp - b.R < (b.atmo ? b.atmo.top : 0)) return `Sub-orbital over ${b.name}`;
  return `Orbiting ${b.name} · ${fmtDist(o.rp - b.R)} × ${fmtDist(o.ra - b.R)}`;
}

/* ---------------- crew ---------------- */

/* Crew entries are { id (roster) or stranded: true, name, pod (part uid) }. */
function crewNames(list) { return (list || []).map((x) => x.name); }

/* Release crew from a vessel that came home: roster members become available (with experience),
   stranded astronauts join the program. */
function crewHome(list, flags) {
  const s = Career.s;
  for (const x of list || []) {
    let cm = x.id ? s.crew.find((c) => c.id === x.id) : null;
    if (!cm && x.stranded && isCareer()) {
      cm = { id: s.crew.length + 1, name: x.name, status: 'available', flights: 0, worlds: [] };
      s.crew.push(cm);
    }
    if (!cm || cm.status === 'lost') continue;
    cm.status = 'available';
    cm.vessel = null;
    cm.flights++;
    for (const w of (flags && flags.visited) || []) if (!cm.worlds.includes(w)) cm.worlds.push(w);
  }
}
/* Mark crew as lost (they were aboard something destroyed). Returns their names. */
function crewLost(list) {
  const s = Career.s, names = [];
  for (const x of list || []) {
    names.push(x.name);
    const cm = x.id ? s.crew.find((c) => c.id === x.id) : null;
    if (cm && cm.status !== 'lost') { cm.status = 'lost'; addRep(-10); }
  }
  return names;
}

/* ---------------- rescue & recovery ---------------- */

/* A lone capsule with a docking port, in a circular orbit, with an astronaut waiting inside. It turns
   slowly with its orbit so its port always faces backwards along its path, ready for a chaser. */
function spawnStranded(s, body, alt, crewName, angle) {
  const parts = layoutDesign(designFromStack(['dockPort', 'pod']));
  const c = new Craft(parts);
  const r = body.R + alt, v = Math.sqrt(body.mu / r), st = bodyState(body, s.ut);
  c.pos = [st[0] + r * Math.cos(angle), st[1] + r * Math.sin(angle)];
  c.vel = [st[2] - v * Math.sin(angle), st[3] + v * Math.cos(angle)];
  c.angle = angle - Math.PI / 2;
  c.angVel = v / r;
  if (!s.vessels) { s.vessels = []; s.vesselSeq = 1; }
  const pod = c.parts.find((p) => p.def.pod);
  const rec = vesselFromCraft(c, s.ut, { id: s.vesselSeq++, name: `${crewName.split(' ').pop()}'s Capsule`,
    crew: [{ name: crewName, stranded: true, pod: pod.uid }], kind: 'stranded', launchT: s.ut,
    flags: { space: true, maxAlt: alt, visited: body === HOME ? [] : [body.id], landedOn: [] } });
  s.vessels.push(rec);
  return rec;
}

/* Recover a vessel that's sitting on Verdan: refund its value, bank its science, bring its crew home. */
function recoverRecord(v) {
  const s = Career.s;
  const parts = deserialiseParts(v.parts);
  let refund = 0, sci = 0;
  for (const p of parts) if (p.result) sci += creditResult(s, p.result, 1);
  if (isCareer() && v.landed) {
    const phi = Math.atan2(v.landed.ry, v.landed.rx);
    refund = parts.reduce((a, p) => a + partValue(p), 0) * recoveryFactor(phi, terrainH(HOME, phi) < 0);
    s.funds += refund;
  }
  crewHome(v.crew, v.flags);
  const done = isCareer() ? checkContracts(s, { kind: 'recover', crew: crewNames(v.crew) }) : [];
  s.vessels = s.vessels.filter((x) => x !== v);
  return { refund, sci, done };
}

/* ---------------- flight checkpoints ----------------
   While you fly, the active vessel (and any nearby vessels loaded alongside it) are written to a separate
   checkpoint every few seconds and whenever the page is hidden or closed. If the game is closed mid-flight,
   the next load puts them back into the universe, so the ship waits in the Tracking Station where you left it. */

const CHECKPOINT_KEY = 'flight';

function saveCheckpoint() {
  if (!F.running || F.tutorial || Career.noPersist || !Career.s || !F.craft) return;
  Store.set(CHECKPOINT_KEY, {
    t: F.t,
    active: F.craft.dead ? null : vesselFromCraft(F.craft, F.t, activeMeta()),
    others: F.others.filter((o) => !o.dead && o.meta).map((o) => vesselFromCraft(o, F.t, o.meta)),
  });
}
function clearCheckpoint() { Store.set(CHECKPOINT_KEY, null); }

/* Put an interrupted flight's vessels back into save s. Returns the checkpoint, or null if there was none. */
function restoreCheckpoint(s) {
  const cp = Store.get(CHECKPOINT_KEY, null);
  if (!cp) return null;
  if (!s.vessels) { s.vessels = []; s.vesselSeq = 1; }
  s.ut = Math.max(s.ut, cp.t || 0);
  for (const v of [cp.active, ...(cp.others || [])]) {
    if (!v) continue;
    s.vessels = s.vessels.filter((x) => x.id !== v.id); // the checkpoint is newer than any stored copy
    s.vessels.push(v);
    s.vesselSeq = Math.max(s.vesselSeq || 1, v.id + 1);
  }
  clearCheckpoint();
  return cp;
}

/* Astronauts marked as flying but aboard no vessel (left behind by an interrupted flight) go back to work. */
function repairCrew(s) {
  const aboard = new Set((s.vessels || []).flatMap((v) => (v.crew || []).filter((x) => x.id).map((x) => x.id)));
  let fixed = 0;
  for (const c of s.crew || []) {
    if (c.status === 'flying' && !aboard.has(c.id)) { c.status = 'available'; c.vessel = null; fixed++; }
  }
  return fixed;
}
