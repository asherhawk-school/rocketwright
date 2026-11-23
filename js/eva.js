'use strict';
/* Rocketwright — spacewalks. An astronaut climbs out of a capsule or cabin (J) and becomes a tiny vessel of their
   own: a jetpack (Q/E, H/N) and suit reaction wheels (A/D) in space, walking (A/D or ←/→) and hopping (Space) on
   the ground. They can plant a flag (L), collect spacewalk reports and surface samples (B), and climb back into
   any capsule or cabin with a free seat (J near it), bringing their science with them. */

const EVA_WALK = 1.6;      // m/s
const EVA_HOP = 2.6;       // m/s
const BOARD_DIST = 4;      // m from the astronaut to the edge of a crewed part
const HATCH_MAX_Q = 2;     // kPa: more air than this rushing past and the hatch stays shut

function oneTreeCraft(id) {
  const c = new Craft(layoutDesign({ parts: [{ uid: 1, id, parent: null }] }));
  c.recompute();
  return c;
}

/* Stand a one-part craft on the ground at angle phi. */
function placeOnGround(c, b, phi, t) {
  const bp = bodyPos(b, t), bv = bodyVel(b, t);
  const lowest = Math.min(...c.contacts.map((p) => p[1]));
  const r = b.R + groundAlt(b, phi) + (c.yc - lowest) + 0.01;
  c.angle = phi;
  c.pos = [bp[0] + r * Math.cos(phi), bp[1] + r * Math.sin(phi)];
  c.vel = [bv[0], bv[1]];
  c.angVel = 0;
  c.landed = { body: b, rx: c.pos[0] - bp[0], ry: c.pos[1] - bp[1] };
}

/* A new astronaut beside the hatch of their part (on the ground next to the ship if it has landed). */
function spawnEva(ship, x, t) {
  const pod = ship.byUid.get(x.pod);
  const e = oneTreeCraft('eva');
  e.rcsOn = true;
  const side = pod && pod.x < ship.xc - 0.05 ? -1 : 1;
  const hx = pod ? pod.x + side * (partWidth(pod) / 2 + 0.45) : ship.xc + side * 1.5;
  const hy = pod ? (pod.top + pod.bot) / 2 : ship.yc;
  if (ship.landed) {
    const b = ship.landed.body, bp = bodyPos(b, t);
    const w = ship.toWorld(hx, hy);
    const shipPhi = Math.atan2(ship.pos[1] - bp[1], ship.pos[0] - bp[0]);
    const dir = Math.sign(wrapPi(Math.atan2(w[1] - bp[1], w[0] - bp[0]) - shipPhi)) || 1;
    placeOnGround(e, b, shipPhi + (dir * (ship.width / 2 + 1.2)) / b.R, t);
  } else {
    e.angle = ship.angle;
    e.pos = ship.toWorld(hx, hy);
    const out = ship.rotLocal(side * 0.5, 0);
    e.vel = [ship.vel[0] + out[0], ship.vel[1] + out[1]];
    e.angVel = ship.angVel;
  }
  return e;
}

/* Take control of a loaded neighbour, keeping the chance to revert the flight. */
function takeOver(o) {
  const keep = { canRevert: F.canRevert, design: F.design, snapshot: F.snapshot, revertCrew: F.revertCrew, revertCrewN: F.revertCrewN,
    site: F.site, flightContracts: F.flightContracts, flightMilestones: F.flightMilestones };
  switchToVessel(o.vid);
  if (keep.canRevert) Object.assign(F, keep);
  else Object.assign(F, { flightContracts: keep.flightContracts, flightMilestones: keep.flightMilestones });
}

function canEva() {
  const c = F.craft;
  return F.running && !F.tutorial && !c.dead && F.kind !== 'eva' && !!universe() && F.crew.some((x) => c.byUid.has(x.pod));
}

/* J: climb out (from a ship) or climb back in (on a spacewalk). */
function evaKey() {
  if (!F.running || F.craft.dead || F.tutorial) return;
  if (F.kind === 'eva') boardNearby(); else goEva();
}

function goEva() {
  const c = F.craft;
  if (!canEva()) { flash(F.crew.length ? 'Nobody can go outside right now' : 'Nobody is aboard to go outside', 2); return; }
  if (F.warp > 0) { flash('Stop time warp first', 2); return; }
  const b = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], F.t);
  if (b.gas || b.star) { flash(`Not here: ${b.name} would swallow them`, 2); return; }
  if (!c.landed && (c.q || 0) > HATCH_MAX_Q) { flash('Too much air rushing past to open the hatch', 2.5); return; }
  const x = F.crew.find((y) => c.byUid.has(y.pod));
  logEvent(`${x.name} went outside`);
  const e = spawnEva(c, x, F.t);
  F.crew = F.crew.filter((y) => y !== x);
  e.vid = newVesselId();
  e.meta = { id: e.vid, name: x.name, crew: [{ ...x, pod: e.parts[0].uid }], kind: 'eva', launchT: F.t, flags: JSON.parse(JSON.stringify(F.flags)) };
  F.others.push(e);
  takeOver(e);
  playSound('stage');
  flash(evaHint(), 7);
}

function evaHint() {
  return F.craft.landed
    ? `${F.craftName} is outside · A/D walk · Space hop · L plant a flag · B science · J climb back in`
    : `${F.craftName} is outside · Q/E and H/N jetpack · A/D turn · B science · J climb back in`;
}

/* The nearest crewed part (on a loaded vessel) with a free seat, close enough to climb into. */
function boardTarget() {
  const e = F.craft;
  let best = null, bd = BOARD_DIST;
  for (const o of F.others) {
    if (o.dead || !o.meta || o.meta.kind === 'eva' || o.meta.kind === 'flag') continue;
    const crew = o.meta.crew || [];
    // standing right beside a landed craft, they can climb up its side to any hatch
    let climb = false;
    if (e.landed && o.landed && o.landed.body === e.landed.body) {
      const da = Math.abs(wrapPi(Math.atan2(e.landed.ry, e.landed.rx) - Math.atan2(o.landed.ry, o.landed.rx)));
      climb = da * Math.hypot(o.landed.rx, o.landed.ry) < o.width / 2 + 2;
    }
    for (const p of o.parts) {
      if (!p.def.seats || crew.filter((x) => x.pod === p.uid).length >= p.def.seats) continue;
      const w = o.toWorld(p.x, (p.top + p.bot) / 2);
      const d = climb ? 0 : Math.hypot(w[0] - e.pos[0], w[1] - e.pos[1]) - Math.max(partWidth(p), p.def.h) / 2;
      if (d < bd) { bd = d; best = { o, p }; }
    }
  }
  return best;
}

function boardNearby() {
  const e = F.craft, t = boardTarget();
  if (!t) { flash('Get within a few metres of a capsule or cabin with a free seat to climb in', 3); return; }
  const { o, p } = t, me = F.crew[0];
  o.meta.crew = (o.meta.crew || []).concat(me ? [{ ...me, pod: p.uid }] : []);
  // science they were carrying goes into the capsule
  const held = e.parts[0].held || [];
  if (held.length) p.held = (p.held || []).concat(held);
  for (const w of F.flags.visited) if (o.meta.flags && !o.meta.flags.visited.includes(w)) o.meta.flags.visited.push(w);
  F.crew = [];
  e.dead = true; // the astronaut isn't a vessel any more
  takeOver(o);
  playSound('dock');
  if (me) logEvent(`${me.name} climbed back aboard`);
  flash(`${me ? me.name : 'The astronaut'} climbed aboard ${o.meta.name}${held.length ? ` with ${held.length} result${held.length > 1 ? 's' : ''}` : ''}`, 3);
}

/* Walking and hopping (player's astronaut, on the ground). */
function evaStep(c, dt) {
  if (F.kind !== 'eva' || c.dead || !c.landed) { F.evaHop = false; return; }
  const L = c.landed, b = L.body;
  const r = Math.hypot(L.rx, L.ry), phi = Math.atan2(L.ry, L.rx);
  if (F.evaHop) {
    F.evaHop = false;
    const bv = bodyVel(b, F.t), ux = L.rx / r, uy = L.ry / r;
    // screen-right is clockwise round the world
    const tx = uy, ty = -ux, w = F.walk || 0;
    c.landed = null;
    c.vel = [bv[0] + ux * EVA_HOP + tx * w * EVA_WALK, bv[1] + uy * EVA_HOP + ty * w * EVA_WALK];
    return;
  }
  if (!F.walk) return;
  const off = clamp(r - (b.R + groundAlt(b, phi)), 0, 3);
  const nphi = phi - (F.walk * EVA_WALK * dt) / r;
  const nr = b.R + groundAlt(b, nphi) + off;
  L.rx = nr * Math.cos(nphi); L.ry = nr * Math.sin(nphi);
  c.angle = nphi;
  c.walkT = (c.walkT || 0) + dt;
}
function evaHop() { if (F.kind === 'eva' && F.craft.landed) F.evaHop = true; }

/* L: plant a flag where the astronaut stands. */
function plantFlag() {
  const e = F.craft;
  if (F.kind !== 'eva' || e.dead || !e.landed) { flash('Plant a flag while standing on the ground on a spacewalk', 2.5); return; }
  const b = e.landed.body, phi = Math.atan2(e.landed.ry, e.landed.rx);
  if (b.ocean && terrainH(b, phi) < 0) { flash('A flag needs solid ground', 2); return; }
  const f = oneTreeCraft('flag');
  placeOnGround(f, b, phi - 1.1 / b.R, F.t);
  f.vid = newVesselId();
  const bio = biomeAt(b, phi);
  const who = (F.crew[0] && F.crew[0].name) || F.craftName;
  f.meta = { id: f.vid, name: `${who.split(' ')[0]}'s flag · ${b.name}${bio ? ` (${bio})` : ''}`, crew: [], kind: 'flag', launchT: F.t,
    flags: { space: false, maxAlt: 0, visited: [], landedOn: [] } };
  F.others.push(f);
  if (b !== HOME) award('flag_' + b.id);
  logEvent(`Planted a flag on ${b.name}${bio ? ` in the ${bio}` : ''}`);
  flightEvent({ kind: 'flag', body: b, biome: bio });
  playSound('dock');
  flash(`Flag planted on ${b.name}${bio ? ` in the ${bio}` : ''}`, 3);
  persist();
}
