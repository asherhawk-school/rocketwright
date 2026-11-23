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
  'shell', 'open', 'area', 'torn', 'inflated', 'brake', 'cellOff', 'gearUp', 'held', 'ore', 'drilling', 'converting', 'lit', 'disarmed', 'grabbed'];

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
    landed: c.landed ? { body: c.landed.body.id, rx: c.landed.rx, ry: c.landed.ry, wheels: !!c.landed.wheels } : null,
    chuteOpen: c.chuteOpen, chuteArea: c.chuteArea, rcsOn: c.rcsOn, docked: meta.docked || {}, actionGroups: c.actionGroups || {},
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
  if (v.landed) c.landed = { body: BODY_BY_ID[v.landed.body], rx: v.landed.rx, ry: v.landed.ry, wheels: !!v.landed.wheels };
  // saves from before parachutes opened one by one
  if (v.chuteOpen && !c.chutes.some((p) => p.open)) for (const p of c.chutes) { p.open = true; p.area = (v.chuteArea || 0) / c.chutes.length; }
  c.recompute();
  c.rcsOn = !!v.rcsOn;
  c.actionGroups = v.actionGroups || {};
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
  for (const p of parts) for (const r of partResults(p)) sci += creditResult(s, r, 1, scienceBonus(s, v.crew));
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

/* ---------------- quick save ----------------
   One saved moment in the current flight that you can go back to as often as you like: the ship and every
   part's state, nearby vessels, the clock, your plans (node, target, SAS) and the whole game save at that
   moment (money, science, contracts, crew). It belongs to one flight of one game. */

const QUICK_KEY = 'quick';
let quickCache; // what's in storage, read once (it can be big)

function clearQuickSave() { Store.set(QUICK_KEY, null); quickCache = null; }
function quickSaveInfo() {
  if (quickCache === undefined) quickCache = Store.get(QUICK_KEY, null);
  const q = quickCache;
  if (!q || !Career.s || q.created !== Career.s.created || q.vid !== F.vid) return null;
  return q;
}
function canQuickSave() { return F.running && !F.tutorial && !Career.noPersist && Career.s && F.craft && !F.craft.dead && !F.endShown; }

function quickSave() {
  if (!canQuickSave()) { if (F.craft && F.craft.dead) flash('Can\'t save: the vessel was destroyed', 2); return false; }
  const c = F.craft, tg = F.target;
  quickCache = {
    created: Career.s.created, vid: F.vid, t: F.t, name: F.craftName,
    save: JSON.stringify(Career.s),
    active: vesselFromCraft(c, F.t, activeMeta()),
    others: F.others.filter((o) => !o.dead && o.meta).map((o) => vesselFromCraft(o, F.t, o.meta)),
    flight: {
      launchT: F.launchT, kind: F.kind, crew: JSON.parse(JSON.stringify(F.crew)), flags: JSON.parse(JSON.stringify(F.flags)),
      dockedMeta: JSON.parse(JSON.stringify(F.dockedMeta || {})), node: F.node ? JSON.parse(JSON.stringify({ ...F.node, pred: null })) : null,
      target: tg ? (tg.vid ? { vid: tg.vid, name: tg.name } : { body: tg.id }) : null, sas: F.sas, hold: F.hold,
      throttle: c.throttle, wheelBrake: !!c.wheelBrake, zoom: F.zoom, flightMilestones: F.flightMilestones.slice(),
    },
  };
  Store.set(QUICK_KEY, quickCache);
  flash(`Saved at ${fmtClock(F.t - F.launchT)}. F9 (or Menu → Load) comes back here.`, 3);
  return true;
}

function quickLoad() {
  const q = quickSaveInfo();
  if (!q || F.tutorial || !F.running) { flash('No save for this flight yet. Press F5 to save.', 2); return false; }
  Career.s = JSON.parse(q.save);
  persist();
  const c = craftFromVessel(q.active), fl = q.flight;
  c.throttle = fl.throttle || 0;
  c.wheelBrake = !!fl.wheelBrake;
  const others = (q.others || []).map((v) => {
    const o = craftFromVessel(v);
    o.meta = { id: v.id, name: v.name, crew: v.crew, launchT: v.launchT, flags: v.flags, kind: v.kind };
    return o;
  });
  Object.assign(F, {
    craft: c, debris: [], others, particles: [], t: q.t, launchT: fl.launchT, crew: fl.crew, crewLost: [], vid: q.vid,
    kind: fl.kind, craftName: q.name, dockedMeta: fl.dockedMeta || {}, flags: fl.flags, flightMilestones: fl.flightMilestones || [],
    node: fl.node, target: fl.target ? (fl.target.vid ? fl.target : BODY_BY_ID[fl.target.body] || null) : null,
    sas: fl.sas || 'stab', hold: fl.hold, acc: 0, warp: 0, deadTimer: 0, endShown: false, deathReason: null, paused: false,
    pred: null, encounter: null, orbit: null, predTick: 0, dvTick: 0, dvCache: null, sciOpen: false, mapPress: null,
    lastBody: c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], q.t), zoom: fl.zoom || F.zoom,
  });
  for (const k in F.keys) F.keys[k] = false;
  if (typeof hideModal === 'function') hideModal();
  if (typeof updateSasButtons === 'function') updateSasButtons();
  if (typeof fillTargetSelect === 'function') fillTargetSelect();
  saveCheckpoint();
  flash(`Loaded the save from ${fmtClock(q.t - fl.launchT)}`, 3);
  return true;
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
