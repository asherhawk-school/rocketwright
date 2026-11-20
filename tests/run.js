#!/usr/bin/env node
/* Rocketwright headless tests: node tests/run.js
   Loads the game scripts into a sandbox with a minimal DOM stub and checks physics, staging and building. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const el = () => ({ appendChild() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {}, remove() {} });
const sandbox = {
  console, Math, Map, Set, Object, Array, Float64Array, JSON, String, Number, isFinite, parseInt, Date, Infinity, NaN,
  localStorage: { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); } },
  document: { getElementById: el, createElement: el, querySelectorAll: () => [] },
  setTimeout: () => 0, clearTimeout: () => {}, window: { devicePixelRatio: 1 },
};
vm.createContext(sandbox);
let src = '';
for (const f of ['data.js', 'vessel.js', 'flight.js']) src += fs.readFileSync(path.join(root, 'js', f), 'utf8') + '\n';
// expose a few lexical globals for the tests
src += '\nthis.__g = { F, PRESETS, PART_DEFS, HOME, MOON, newDesign, attachPart, removePartTree, extractSubtree, insertSubtree, designFromStack, migrateDesign, layoutDesign, analyzeDesign, resolveStages, stageListFrom, autoStages, Craft, cloneParts, simulateStages, flightStart, doStage, stepCraft, railsStep, orbitElements, soiBody, bodyPos, wrapPi, clamp, PHYS_DT, WARPS, isEngine };';
vm.runInContext(src, sandbox);
const G = sandbox.__g;
G.F.H = 800; G.F.W = 1200; G.F.hud = {};

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message ? e.message : e)); }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* Autopilot: gravity turn, stage when the current stage is spent, coast to apoapsis, circularise. */
function flyToOrbit(design, name, opts = {}) {
  const { F } = G;
  G.flightStart(design, name);
  const c = () => F.craft;
  G.doStage();
  let phase = 'ascent';
  const log = { separations: 0, maxSpin: 0 };
  for (let i = 0; i < 300000; i++) {
    const k = c();
    const b = G.soiBody(k.pos[0], k.pos[1], F.t), bp = G.bodyPos(b, F.t);
    const alt = Math.hypot(k.pos[0] - bp[0], k.pos[1] - bp[1]) - b.R;
    const up = Math.atan2(k.pos[1], k.pos[0]);
    const o = k.landed ? null : G.orbitElements(b, k.pos[0], k.pos[1], k.vel[0], k.vel[1], F.t);
    const pitchDeg = alt < 1000 ? 90 : Math.max(0, 90 - 90 * Math.pow((alt - 1000) / 45000, 0.6));
    let target = up - ((90 - pitchDeg) * Math.PI) / 180;
    if (phase === 'circ') target = Math.atan2(k.vel[1], k.vel[0]);
    const err = G.wrapPi(target - k.angle);
    const maxA = Math.max((k.torque + k.gimbalCap) / k.I, 1e-3);
    k.ctrl = G.clamp((err * 2 - k.angVel * 3) / maxA, -1, 1);
    // stage when every lit engine is out of fuel
    const lit = k.engines.filter((e) => e.ignited);
    const spent = lit.length === 0 || lit.every((e) => !k.engineHasFuel(e));
    const srbOut = lit.some((e) => e.def.solid && e.solid <= 0);
    if ((spent || srbOut) && k.stageIdx < k.stages.length - 1) {
      const before = F.debris.length;
      G.doStage();
      log.separations += F.debris.length - before;
    }
    if (phase === 'ascent') { k.throttle = 1; if (o && alt > 2000 && o.e < 1 && o.ra - b.R > 80000) { k.throttle = 0; phase = 'coast'; } }
    else if (phase === 'coast') { k.throttle = 0; if (alt > 65000 && o.tAp < 25) phase = 'circ'; }
    else if (phase === 'circ') { k.throttle = Math.abs(err) < 0.1 ? 1 : 0; if (o.rp - b.R > 72000) { k.throttle = 0; phase = 'done'; } }
    G.stepCraft(k, G.PHYS_DT, true);
    for (const d of F.debris) G.stepCraft(d, G.PHYS_DT, false);
    F.t += G.PHYS_DT;
    log.maxSpin = Math.max(log.maxSpin, Math.abs(k.angVel));
    if (k.dead) { log.dead = true; break; }
    if (phase === 'done') break;
    if (opts.stopAfter && F.t > opts.stopAfter) break;
  }
  const k = c();
  const b = G.soiBody(k.pos[0], k.pos[1], F.t);
  const o = G.orbitElements(b, k.pos[0], k.pos[1], k.vel[0], k.vel[1], F.t);
  return { ...log, phase, ap: o.ra - b.R, pe: o.rp - b.R, craft: k, t: F.t };
}

console.log('Building');
test('every preset lays out, is valid and has delta-v', () => {
  for (const [name, mk] of Object.entries(G.PRESETS)) {
    const a = G.analyzeDesign(mk());
    assert(a.valid, name + ' invalid: ' + JSON.stringify(a.warnings));
    assert(a.total > 1500, `${name} total Δv only ${a.total.toFixed(0)}`);
    assert(a.rows[0].twr > 1, `${name} liftoff TWR ${a.rows[0].twr}`);
  }
});
test('Orbiter I delta-v matches the rocket equation (about 4,880 m/s)', () => {
  // upper: pod 0.85 + 0.1 mono, chute 0.1, Tank M-2 2.25, Wren 0.5; lower: decoupler, 2× Tank L-4, 2 fins, Ox
  const up0 = 0.95 + 0.1 + 2.25 + 0.5, up1 = up0 - 2;
  const lo0 = up0 + 0.05 + 9 + 0.12 + 1.6, lo1 = lo0 - 8;
  const expect = 300 * 9.80665 * Math.log(lo0 / lo1) + 345 * 9.80665 * Math.log(up0 / up1);
  const a = G.analyzeDesign(G.PRESETS['Orbiter I']());
  assert(near(a.total, expect, 15), `got ${a.total.toFixed(0)}, expected ${expect.toFixed(0)}`);
});
test('old flat saves migrate, with fins/legs as mirrored side pairs', () => {
  const d = G.migrateDesign(['chute', 'pod', 'tankL', 'legs', 'wren', 'decoupler', 'tankL', 'fins', 'ox']);
  const legs = d.parts.filter((p) => p.id === 'legs');
  const fins = d.parts.filter((p) => p.id === 'fins');
  assert(legs.length === 2 && fins.length === 2, 'expected pairs');
  assert(legs[0].sym && legs[0].sym === legs[1].sym && legs[0].side === -legs[1].side, 'legs not mirrored');
  const geo = G.layoutDesign(d);
  const lg = geo.filter((g) => g.id === 'legs');
  assert(near(lg[0].x, -lg[1].x, 1e-9) && lg[0].flip !== lg[1].flip, 'legs not placed symmetrically');
});
test('Heavy Lifter auto-staging: boosters + core at launch, then boosters drop, then upper stage', () => {
  const d = G.PRESETS['Heavy Lifter']();
  const geo = G.layoutDesign(d);
  const stages = G.stageListFrom(G.resolveStages(d, geo));
  const ids = (s) => s.map((u) => geo.find((g) => g.uid === u).id).sort().join(',');
  assert(stages.length === 4, 'stages: ' + stages.map(ids).join(' | '));
  assert(ids(stages[0]) === 'ox,srb,srb', 'stage 1: ' + ids(stages[0]));
  assert(ids(stages[1]) === 'radDec,radDec', 'stage 2: ' + ids(stages[1]));
  assert(ids(stages[2]) === 'decoupler,wren', 'stage 3: ' + ids(stages[2]));
  assert(ids(stages[3]) === 'chute', 'stage 4: ' + ids(stages[3]));
});
test('side boosters are mirrored and centre of mass stays on the centreline', () => {
  const c = new G.Craft(G.layoutDesign(G.PRESETS['Heavy Lifter']()));
  assert(Math.abs(c.xc) < 1e-9, 'xc = ' + c.xc);
  const srbs = c.parts.filter((p) => p.id === 'srb');
  assert(srbs.length === 2 && near(srbs[0].x, -srbs[1].x, 1e-9), 'boosters not mirrored');
});
test('decouplers block fuel; crossfeed decouplers drain boosters before the core', () => {
  const d = G.newDesign();
  const pod = G.attachPart(d, 'pod', null)[0];
  const core = G.attachPart(d, 'tankL', pod, 'bottom')[0];
  G.attachPart(d, 'ox', core, 'bottom');
  const rd = G.attachPart(d, 'radDecX', core, 'side', 1, 0.5, true)[0];
  const bt = G.attachPart(d, 'tankL', rd, 'side', 1, 0, false)[0];
  G.attachPart(d, 'kestrel', bt, 'bottom');
  const geo = G.layoutDesign(d);
  const c = new G.Craft(geo, { stages: G.stageListFrom(G.resolveStages(d, geo)) });
  const tanks = c.parts.filter((p) => p.id === 'tankL');
  assert(new Set(tanks.map((t) => c.groups.get(t.uid))).size === 1, 'crossfeed should share one fuel group');
  c.activateNext(null);
  c.throttle = 1;
  for (let i = 0; i < 20; i++) c.engineStep(0.5, 0);
  const coreTank = c.parts.find((p) => p.uid === core), sideTanks = tanks.filter((t) => t.uid !== core);
  assert(near(coreTank.fuel, 4, 1e-9), 'core tank drained first: ' + coreTank.fuel);
  assert(sideTanks.every((t) => t.fuel < 4), 'side tanks should drain');
  // the same rocket with plain radial decouplers keeps fuel separate
  d.parts.forEach((p) => { if (p.id === 'radDecX') p.id = 'radDec'; });
  const g2 = G.layoutDesign(d);
  const c2 = new G.Craft(g2);
  assert(new Set(c2.parts.filter((p) => p.id === 'tankL').map((t) => c2.groups.get(t.uid))).size === 3, 'plain decouplers should split fuel');
});
test('a lone side engine makes off-centre thrust (torque)', () => {
  const d = G.newDesign();
  const pod = G.attachPart(d, 'pod', null)[0];
  const t = G.attachPart(d, 'tankL', pod, 'bottom')[0];
  G.attachPart(d, 'sparrow', t, 'side', 1, 2, false);
  const c = new G.Craft(G.layoutDesign(d));
  c.parts.find((p) => p.id === 'sparrow').ignited = true;
  c.throttle = 1;
  c.engineStep(0.1, 0);
  assert(Math.abs(c.thrustTorque) > 1, 'torque ' + c.thrustTorque);
});
test('removing a mirrored part removes its twin and everything attached', () => {
  const d = G.PRESETS['Heavy Lifter']();
  const n = d.parts.length;
  const rd = d.parts.find((p) => p.id === 'radDec');
  G.removePartTree(d, rd.uid);
  assert(d.parts.length === n - 6, `removed ${n - d.parts.length}, expected 6`);
  assert(!d.parts.some((p) => p.id === 'srb' || p.id === 'nose2'), 'boosters left behind');
});
test('moving a subassembly keeps its children', () => {
  const d = G.PRESETS['Heavy Lifter']();
  const rd = d.parts.find((p) => p.id === 'radDec');
  const sub = G.extractSubtree(d, rd.uid);
  const tl = d.parts.find((p) => p.id === 'tankL').uid;
  const uids = G.attachPart(d, 'radDec', tl, 'side', 1, 0.3, true);
  G.insertSubtree(d, sub, uids);
  assert(d.parts.filter((p) => p.id === 'srb').length === 2 && d.parts.filter((p) => p.id === 'nose2').length === 2, 'subtree lost');
  const geo = G.layoutDesign(d);
  const s = geo.filter((g) => g.id === 'srb');
  assert(near(s[0].x, -s[1].x, 1e-9), 'moved boosters not mirrored');
});
test('manual staging survives and new parts get automatic stages', () => {
  const d = G.PRESETS['Orbiter I']();
  const geo = G.layoutDesign(d);
  const m = G.resolveStages(d, geo);
  const chute = geo.find((g) => g.id === 'chute').uid;
  d.stageOf = { ...m, [chute]: 0 }; // parachute fires with liftoff
  const m2 = G.resolveStages(d, G.layoutDesign(d));
  assert(m2[chute] === m2[geo.find((g) => g.id === 'ox').uid], 'manual stage not kept');
});

console.log('Flight');
test('Orbiter I reaches orbit under autopilot', () => {
  const r = flyToOrbit(G.PRESETS['Orbiter I'](), 'Orbiter I');
  assert(!r.dead, 'crashed');
  assert(r.phase === 'done' && r.pe > 70000, `phase ${r.phase}, Ap ${r.ap.toFixed(0)}, Pe ${r.pe.toFixed(0)}`);
});
test('Heavy Lifter drops both boosters cleanly and reaches orbit', () => {
  const r = flyToOrbit(G.PRESETS['Heavy Lifter'](), 'Heavy Lifter');
  assert(!r.dead, 'crashed');
  assert(r.separations >= 3, 'separations ' + r.separations);
  assert(r.maxSpin < 0.6, 'spun at ' + r.maxSpin.toFixed(2) + ' rad/s');
  assert(r.phase === 'done' && r.pe > 70000, `phase ${r.phase}, Ap ${r.ap.toFixed(0)}, Pe ${r.pe.toFixed(0)}`);
});
test('orbit holds steady under time warp', () => {
  const { F } = G;
  const r = flyToOrbit(G.PRESETS['Orbiter I'](), 'Orbiter I');
  const k = r.craft;
  const b = G.soiBody(k.pos[0], k.pos[1], F.t);
  const o1 = G.orbitElements(b, k.pos[0], k.pos[1], k.vel[0], k.vel[1], F.t);
  F.warp = 7;
  const t0 = F.t;
  for (let i = 0; i < 20000 && F.t - t0 < o1.period * 3; i++) G.railsStep((1 / 60) * G.WARPS[F.warp]);
  const o2 = G.orbitElements(b, k.pos[0], k.pos[1], k.vel[0], k.vel[1], F.t);
  assert(near(o1.ra, o2.ra, 300) && near(o1.rp, o2.rp, 300), `Ap ${o1.ra - b.R}→${o2.ra - b.R}, Pe ${o1.rp - b.R}→${o2.rp - b.R}`);
});
test('Pallid Lander stack stages in the right order', () => {
  const d = G.PRESETS['Pallid Lander']();
  const geo = G.layoutDesign(d);
  const stages = G.stageListFrom(G.resolveStages(d, geo));
  const ids = (s) => s.map((u) => geo.find((g) => g.uid === u).id).sort().join(',');
  assert(stages.map(ids).join(' | ') === 'bison | decoupler,kestrel | decoupler,wren | chute', stages.map(ids).join(' | '));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
