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
for (const f of ['data.js', 'vessel.js', 'systems.js', 'navigation.js', 'docking.js', 'sound.js', 'career/career.js', 'career/science.js', 'career/tech.js', 'career/contracts.js', 'universe.js', 'flight.js', 'partmenu.js', 'tutorials.js']) src += fs.readFileSync(path.join(root, 'js', f), 'utf8') + '\n';
// expose a few lexical globals for the tests
src += '\nthis.__g = { F, PRESETS, PART_DEFS, HOME, MOON, newDesign, attachPart, removePartTree, extractSubtree, insertSubtree, designFromStack, migrateDesign, layoutDesign, analyzeDesign, resolveStages, stageListFrom, autoStages, Craft, cloneParts, simulateStages, flightStart, doStage, stepCraft, railsStep, orbitElements, soiBody, bodyPos, bodyState, wrapPi, clamp, PHYS_DT, WARPS, isEngine, BODIES, BODY_BY_ID, SUN, OCHRE, GALE, TEMPEST, predictPath, loadMilestones, Store, physStep, findEncounter, Career, newSave, designCost, lockedParts, research, PART_TECH, TECH_NODES, runExperiment, creditResult, transmit, subjectCap, situationOf, refreshContracts, acceptContract, checkContracts, genContract, reachableBodies, recoveryFactor, flightUpdate, HOME, MOON, DAY, explode, partUnlocked, ecTotal, electricStep, solarInput, inShadow, hasControl, heatStep, destroyPart, makeNode, updateNode, burnTime, dvMapRows, launchDv, transferWindow, controlInput, propagate, stepLimitG: stepLimit, vesselFromCraft, craftFromVessel, advanceVessel, advanceAll, flightLoadVessel, universe, findDock, dockCrafts, dockedPairs, undockParts, portFacing, spawnStranded, crewHome, crewNames, TUTORIALS, playSound, recoverRecord, saveCheckpoint, clearCheckpoint, restoreCheckpoint, repairCrew, loadSave, setSave, persist, Store, setPartCfg, cfgVal, normalizeStages, screenToCraft, partAt, fireDecoupler, designSeats, shellH, jettisonFairing, toggleBrakes, stageLabel, ecDrain, toggleGear, liftCoef, jetFactor, wheelPoint, terrainH, PAD_PHI, RUNWAY_START, RUNWAY_END };';
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
    if (name === 'Swallow Jet' || name === 'Dune Rover') continue; // a plane and a rover: no rocket Δv
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


console.log('Solar system');
test('sphere of influence lookup finds the deepest body', () => {
  const B = G.BODY_BY_ID, t = 1234;
  const at = (b, dx, dy) => { const p = G.bodyPos(b, t); return G.soiBody(p[0] + dx, p[1] + dy, t).id; };
  assert(G.soiBody(0, 500010, t).id === 'verdan', 'pad');
  assert(at(B.pallid, 0, 160000) === 'pallid', 'Pallid surface');
  assert(at(B.gale, 0, 500000) === 'gale', 'Gale');
  assert(at(B.tempest, 0, 8e6) === 'tempest', 'Tempest');
  assert(at(B.ochre, 0, 1e6) === 'ochre', 'near Ochre');
  assert(at(B.pip, 0, 30000) === 'pip', 'Pip');
  assert(G.soiBody(2e9, 0, t).id === 'helion', 'deep space');
});
test('every moon sits inside its planet\'s sphere of influence', () => {
  for (const b of G.BODIES) if (b.parent && !b.parent.star) assert(b.orbitR + b.soi < b.parent.soi, b.name);
});
test('body accelerations match their motion (frame correction is right)', () => {
  for (const b of [G.BODY_BY_ID.pallid, G.GALE, G.SUN, G.OCHRE]) {
    const t = 5e5, h = 5;
    const p0 = G.bodyPos(b, t - h), p1 = G.bodyPos(b, t), p2 = G.bodyPos(b, t + h);
    const ax = (p0[0] - 2 * p1[0] + p2[0]) / (h * h), ay = (p0[1] - 2 * p1[1] + p2[1]) / (h * h);
    const s = G.bodyState(b, t);
    const mag = Math.hypot(s[4], s[5]);
    assert(Math.hypot(ax - s[4], ay - s[5]) < Math.max(1e-6, mag * 2e-3), `${b.name}: numeric (${ax}, ${ay}) vs (${s[4]}, ${s[5]})`);
  }
});
test('a circular orbit around Gale (a moon of a moon\'s planet) holds under warp', () => {
  const { F } = G;
  G.flightStart(G.PRESETS['Orbiter I'](), 'Probe');
  const c = F.craft; c.landed = null; c.throttle = 0;
  F.t = 2e6;
  const s = G.bodyState(G.GALE, F.t), r = G.GALE.R + 120000, v = Math.sqrt(G.GALE.mu / r);
  c.pos = [s[0] + r, s[1]]; c.vel = [s[2], s[3] + v];
  F.debris = [];
  const o1 = G.orbitElements(G.GALE, c.pos[0], c.pos[1], c.vel[0], c.vel[1], F.t);
  F.warp = 8;
  const t0 = F.t;
  for (let i = 0; i < 20000 && F.t - t0 < o1.period * 2; i++) G.railsStep((1 / 60) * G.WARPS[F.warp]);
  const b = G.soiBody(c.pos[0], c.pos[1], F.t);
  const o2 = G.orbitElements(b, c.pos[0], c.pos[1], c.vel[0], c.vel[1], F.t);
  assert(b === G.GALE, 'drifted out of Gale\'s SOI into ' + b.name);
  assert(Math.abs(o2.rp - o1.rp) < 500 && Math.abs(o2.ra - o1.ra) < 500, `Pe ${o1.rp - r}→${o2.rp - r}, Ap ${o1.ra - r}→${o2.ra - r}`);
});
test('a Hohmann transfer from Verdan\'s orbit predicts an Ochre encounter', () => {
  const mu = G.SUN.mu, r1 = G.BODY_BY_ID.verdan.orbitR + 3e8, r2 = G.OCHRE.orbitR;
  const tt = Math.PI * Math.sqrt(Math.pow((r1 + r2) / 2, 3) / mu);
  const t0 = 0;
  // depart opposite where Ochre will be on arrival
  const sun = G.bodyState(G.SUN, t0);
  const oA = G.OCHRE.phase0 + G.OCHRE.n * (t0 + tt);
  const dep = oA - Math.PI;
  const v = Math.sqrt(mu / r1) * Math.sqrt((2 * r2) / (r1 + r2));
  const x = sun[0] + r1 * Math.cos(dep), y = sun[1] + r1 * Math.sin(dep);
  const vx = sun[2] - v * Math.sin(dep), vy = sun[3] + v * Math.cos(dep);
  assert(G.soiBody(x, y, t0) === G.SUN, 'start should be in Helion\'s SOI');
  const pred = G.predictPath(x, y, vx, vy, t0);
  const enc = (G.findEncounter(pred) || []).find((e) => e.kind === 'enc');
  assert(enc && enc.body === G.OCHRE, 'events: ' + JSON.stringify(pred.events.map((e) => e.type + ':' + (e.to ? e.to.id : e.b ? e.b.id : ''))));
  assert(Math.abs(enc.t - tt) < tt * 0.1, `arrival ${enc.t.toFixed(0)} vs ${tt.toFixed(0)}`);
});
test('burning to escape velocity shows "Leaving Verdan" on the predicted path', () => {
  const r = 600000, v = Math.sqrt((2 * G.BODY_BY_ID.verdan.mu) / r) * 1.05;
  const pred = G.predictPath(r, 0, 0, v, 0);
  const evs = G.findEncounter(pred) || [];
  assert(evs.length && evs[0].kind === 'exit' && evs[0].body.id === 'verdan', JSON.stringify(evs.map((e) => e.kind)));
});
test('sinking into the gas giant destroys the craft', () => {
  const { F } = G;
  G.flightStart(G.PRESETS['Sky Hopper'](), 'Diver');
  const c = F.craft; c.landed = null;
  F.t = 1e6;
  const s = G.bodyState(G.TEMPEST, F.t);
  c.pos = [s[0], s[1] + G.TEMPEST.R + 2]; c.vel = [s[2], s[3] - 0.5];
  for (let i = 0; i < 400 && !c.dead; i++) G.physStep(G.PHYS_DT);
  assert(c.dead, 'should be crushed');
  assert(/Crushed/.test(F.deathReason), F.deathReason);
});
test('old Pallid milestone ids carry over', () => {
  G.Store.set('milestones', { moonLand: 123, orbit: 5 });
  const m = G.loadMilestones();
  assert(m.land_pallid === 123 && !m.moonLand && m.orbit === 5, JSON.stringify(m));
});

console.log('Career');
const career = (seed = 42) => { const s = G.newSave('career', seed); G.Career.s = s; return s; };
G.career = career;
test('a new career starts with funds, three astronauts and only the basic parts', () => {
  const s = career();
  assert(s.funds === 25000 && s.crew.length === 3, `funds ${s.funds}, crew ${s.crew.length}`);
  assert(G.partUnlocked('pod') && G.partUnlocked('srb') && !G.partUnlocked('ox') && !G.partUnlocked('tankL'), 'unlocks');
  const hop = G.PRESETS['Sky Hopper']();
  assert(G.designCost(hop) === 1700 && G.lockedParts(hop).length === 0, 'Sky Hopper cost ' + G.designCost(hop));
  assert(G.lockedParts(G.PRESETS['Orbiter I']()).length > 0, 'Orbiter I should need research');
});
test('every part belongs to exactly one research node', () => {
  for (const id of Object.keys(G.PART_DEFS)) assert(G.PART_TECH[id], id + ' is not in the tech tree');
  const all = G.TECH_NODES.flatMap((n) => n.parts);
  assert(all.length === new Set(all).size, 'a part is in two nodes');
});
test('research needs science and its prerequisites, then unlocks parts', () => {
  const s = career();
  assert(G.research(s, 'advanced') !== null, 'locked node should fail');
  assert(G.research(s, 'general') !== null, 'should need science');
  s.science = 40;
  assert(G.research(s, 'general') === null && G.research(s, 'advanced') === null, 'should succeed');
  assert(s.science === 5 && G.partUnlocked('ox') && G.partUnlocked('tankL'), `science ${s.science}`);
});
test('science: transmitting pays half, recovering pays the rest, repeats pay less', () => {
  const s = career();
  const p = { def: G.PART_DEFS.thermo };
  const cap = G.subjectCap('thermo', G.MOON, 'landed');
  G.runExperiment(s, p, G.MOON, 'landed');
  const tx = G.transmit(s, p);
  assert(Math.abs(tx.gain - cap / 2) < 1e-9, 'transmit ' + tx.gain);
  G.runExperiment(s, p, G.MOON, 'landed');
  const rec = G.creditResult(s, p.result, 1);
  assert(Math.abs(rec - cap / 2) < 1e-9 && Math.abs(s.science - cap) < 0.11, `recover ${rec}, total ${s.science}`);
  G.runExperiment(s, p, G.MOON, 'landed');
  assert(G.creditResult(s, p.result, 1) < 1e-9, 'subject should be used up');
  assert(G.subjectCap('thermo', G.MOON, 'landed') > G.subjectCap('thermo', G.HOME, 'landed') * 3, 'Pallid worth more than home');
});
test('contracts are generated deterministically from the seed', () => {
  const a = career(7); G.refreshContracts(a);
  const b = career(7); G.refreshContracts(b);
  assert(JSON.stringify(a.contracts) === JSON.stringify(b.contracts), 'same seed, different offers');
  assert(a.contracts.length === 4 && a.contracts.every((c) => c.state === 'offered'), 'offers: ' + a.contracts.length);
});
test('early contracts stay at home; Pallid opens up after reaching orbit', () => {
  const s = career(3);
  assert(G.reachableBodies(s).map((b) => b.id).join() === 'verdan', 'start');
  for (let i = 0; i < 40; i++) { const c = G.genContract(s); if (c && c.p.body) assert(c.p.body === 'verdan', c.title); }
  s.milestones.orbit = 1;
  assert(G.reachableBodies(s).some((b) => b.id === 'pallid'), 'Pallid should be reachable');
});
test('accepting pays the advance; completing pays the reward; missing the deadline costs a penalty', () => {
  const s = career(11);
  const mk = (km) => ({ id: s.contractSeq++, type: 'altitude', title: 'Reach ' + km, desc: '', p: { km }, reward: 5000, sci: 3, rep: 2,
    days: 10, state: 'offered', advance: 700, penalty: 1500, expires: 1e12 });
  const c1 = mk(5), c2 = mk(50);
  s.contracts.push(c1, c2);
  assert(G.acceptContract(s, c1.id) === null && G.acceptContract(s, c2.id) === null, 'accept');
  assert(s.funds === 25000 + 1400, 'advance');
  const done = G.checkContracts(s, { kind: 'tick', body: G.HOME, alt: 6000 });
  assert(done.length === 1 && done[0] === c1 && s.funds === 26400 + 5000 && s.science === 3, `funds ${s.funds}`);
  s.ut = 11 * G.DAY;
  G.refreshContracts(s);
  assert(c2.state === 'failed' && s.funds === 31400 - 1500, `c2 ${c2.state}, funds ${s.funds}`);
});
test('recovery pays most near the launch site and less far away', () => {
  assert(G.recoveryFactor(Math.PI / 2) === 1, 'pad');
  assert(G.recoveryFactor(Math.PI / 2 + 0.1) > 0.9, 'nearby');
  assert(G.recoveryFactor(-Math.PI / 2) < 0.15, 'far side');
});
test('in flight, reaching the target altitude completes the contract', () => {
  const s = career(5);
  const c = { id: 99, type: 'altitude', title: 'Reach 5 km', desc: '', p: { km: 5 }, reward: 3000, sci: 2, rep: 2, days: 30, state: 'offered', advance: 400, penalty: 900, expires: 1e12 };
  s.contracts.push(c);
  G.acceptContract(s, 99);
  const { F } = G;
  G.flightStart(G.PRESETS['Sky Hopper'](), 'Hopper', { t0: s.ut });
  G.doStage();
  for (let i = 0; i < 60 * 60 && c.state === 'active'; i++) G.flightUpdate(1 / 60);
  assert(c.state === 'done', 'contract not completed; alt ' + (Math.hypot(...F.craft.pos) - 500000).toFixed(0));
  assert(s.milestones.liftoff, 'liftoff milestone should be in the career save');
});
test('a crash loses the astronaut and reputation', () => {
  const s = career(8);
  const { F } = G;
  G.flightStart(G.PRESETS['Sky Hopper'](), 'Hopper', { t0: 0 });
  F.crew = [{ id: s.crew[1].id, name: s.crew[1].name, pod: F.craft.parts.find((p) => p.def.pod).uid }];
  s.crew[1].status = 'flying';
  s.rep = 20;
  G.explode(F.craft, true, 50);
  assert(s.crew[1].status === 'lost' && s.rep === 10, `${s.crew[1].status}, rep ${s.rep}`);
  G.Career.s = null;
});

console.log('Systems & navigation');
const craftFrom = (ids, extra) => { const d = G.designFromStack(ids); if (extra) extra(d); return d; };
const placeInOrbit = (alt, t0 = 0) => {
  const { F } = G; const c = F.craft; c.landed = null; F.t = t0; F.debris = [];
  const r = G.HOME.R + alt, v = Math.sqrt(G.HOME.mu / r);
  c.pos = [r, 0]; c.vel = [0, v]; c.angle = Math.PI / 2; c.angVel = 0; F.lastBody = G.HOME;
  return c;
};
test('a probe core can fly a craft with no crew', () => {
  const a = G.analyzeDesign(craftFrom(['probe', 'tankS125', 'gnat']));
  assert(a.valid, JSON.stringify(a.warnings));
  assert(a.warnings.some((w) => /batteries or solar/.test(w.text)), 'should suggest more power');
});
test('solar panels charge in sunlight and not in a planet\'s shadow', () => {
  const { F } = G;
  G.flightStart(craftFrom(['probe', 'tankS125', 'gnat'], (d) => { const p = d.parts[0].uid; G.attachPart(d, 'solar', p, 'side', 1, 0, true); }), 'Sat');
  const c = placeInOrbit(300000);
  const sun = G.bodyPos(G.SUN, F.t);
  const toSun = Math.atan2(sun[1] - c.pos[1], sun[0] - c.pos[0]);
  // put the craft on the sunny side, panels facing the sun
  const r = c.pos[0];
  c.pos = [r * Math.cos(toSun), r * Math.sin(toSun)];
  c.angle = toSun + Math.PI / 2;
  assert(!G.inShadow(c, F.t) && G.solarInput(c, F.t) > 1.5, 'sunlit input ' + G.solarInput(c, F.t));
  c.pos = [-r * Math.cos(toSun), -r * Math.sin(toSun)];
  assert(G.inShadow(c, F.t) && G.solarInput(c, F.t) === 0, 'should be in shadow');
});
test('a probe with a flat battery cannot steer or stage', () => {
  const { F } = G;
  G.flightStart(craftFrom(['probe', 'tankS125', 'gnat']), 'Dead probe');
  const c = F.craft;
  for (const p of c.parts) p.ec = 0;
  G.electricStep(c, 0.02, 0, 0);
  assert(!G.hasControl(c), 'should have lost control');
  F.userRot = 1;
  assert(G.controlInput(c) === 0, 'rotation should do nothing');
  F.userRot = 0;
  G.doStage();
  assert(c.stageIdx === 0, 'staging should be blocked');
});
test('reaction wheels drain the battery', () => {
  const { F } = G;
  G.flightStart(G.PRESETS['Sky Hopper'](), 'Spinner');
  const c = placeInOrbit(200000);
  const e0 = G.ecTotal(c);
  for (let i = 0; i < 500; i++) G.electricStep(c, 0.02, 1e5, 10);
  assert(G.ecTotal(c) < e0 - 7, `charge ${e0} -> ${G.ecTotal(c)}`);
});
/* Drop a capsule into the air at speed; return whether it survived. */
function reentry(withShield) {
  const { F } = G;
  const ids = withShield ? ['chute', 'pod', 'shield2'] : ['chute', 'pod'];
  G.flightStart(G.designFromStack(ids), 'Capsule');
  const c = F.craft; c.landed = null; F.t = 0; F.debris = [];
  const r = G.HOME.R + 69000, fpa = -0.25, v = 3200;
  c.pos = [0, r]; c.vel = [v * Math.cos(fpa), v * Math.sin(fpa)];
  c.angle = Math.atan2(c.vel[1], c.vel[0]) + Math.PI; // heat shield first
  F.sas = 'retro';
  let maxT = 0;
  for (let i = 0; i < 60 * 400 && !c.dead; i++) {
    c.ctrl = G.controlInput(c);
    G.stepCraft(c, G.PHYS_DT, true);
    F.t += G.PHYS_DT;
    for (const p of c.parts) if (p.def.pod) maxT = Math.max(maxT, p.temp);
    if (Math.hypot(...c.pos) - G.HOME.R < 15000) break;
  }
  return { dead: c.dead, maxT };
}
test('a fast, steep reentry burns up a bare capsule but not one with a heat shield', () => {
  const bare = reentry(false), shielded = reentry(true);
  assert(bare.dead, 'bare capsule survived (peak ' + bare.maxT.toFixed(0) + ' K)');
  assert(!shielded.dead && shielded.maxT < 1500, 'shielded capsule: dead ' + shielded.dead + ', peak ' + shielded.maxT.toFixed(0) + ' K');
});
test('an overheated fin breaks off and the rest of the craft flies on', () => {
  const { F } = G;
  G.flightStart(G.PRESETS['Orbiter I'](), 'Finless');
  const c = F.craft, fin = c.parts.find((p) => p.def.fins), n = c.parts.length;
  G.destroyPart(c, fin);
  assert(!c.dead && c.parts.length === n - 1 && !c.parts.includes(fin), 'parts ' + c.parts.length);
});
test('a manoeuvre node plans a burn, and flying it gives the planned orbit', () => {
  const { F } = G;
  G.flightStart(G.PRESETS['Orbiter I'](), 'Planner');
  G.doStage(); G.doStage(); // drop to the upper stage
  const c = placeInOrbit(100000);
  c.throttle = 0;
  F.node = G.makeNode(F.t + 400);
  F.node.pro = 250;
  G.updateNode(F.node, c, F.t);
  const b = G.HOME;
  const plannedAp = Math.max(...F.node.pred.pts.map((p) => Math.hypot(p.x, p.y))) - b.R;
  F.sas = 'node';
  const bt = G.burnTime(c, 250);
  assert(bt > 5 && bt < 200, 'burn time ' + bt);
  let i = 0;
  for (; i < 60 * 1500 && F.node; i++) {
    c.ctrl = G.controlInput(c);
    const n = F.node;
    const aim = Math.atan2(n.remaining[1], n.remaining[0]);
    const aligned = Math.abs(G.wrapPi(aim - c.angle)) < 0.05;
    c.throttle = F.t > n.t - bt / 2 && aligned ? 1 : 0;
    G.stepCraft(c, G.PHYS_DT, true);
    F.t += G.PHYS_DT;
  }
  assert(!F.node, 'node never completed');
  const o = G.orbitElements(b, c.pos[0], c.pos[1], c.vel[0], c.vel[1], F.t);
  const ap = o.ra - b.R;
  assert(Math.abs(ap - plannedAp) / plannedAp < 0.06, `planned Ap ${plannedAp.toFixed(0)}, got ${ap.toFixed(0)}`);
});
test('the Δv map and transfer window give sensible numbers', () => {
  const rows = Object.fromEntries(G.dvMapRows().map((r) => [r.b.id, r]));
  assert(rows.pallid.transfer > 700 && rows.pallid.transfer < 850, 'Pallid ' + rows.pallid.transfer);
  assert(rows.ochre.transfer > 900 && rows.ochre.transfer < 1100, 'Ochre ' + rows.ochre.transfer);
  const l = G.launchDv(G.HOME);
  assert(l > 3000 && l < 3600, 'launch ' + l);
  const { F } = G;
  G.flightStart(G.PRESETS['Orbiter I'](), 'Window');
  const c = placeInOrbit(100000);
  const w = G.transferWindow(c, G.MOON, F.t);
  const deg = (w.ideal * 180) / Math.PI;
  assert(deg > 100 && deg < 130 && isFinite(w.wait), 'ideal ' + deg);
});

console.log('Persistent universe');
test('a vessel saves and loads without losing parts, fuel or staging', () => {
  const { F } = G;
  G.Career.s = G.newSave('sandbox', 1); G.universe();
  G.flightStart(G.PRESETS['Heavy Lifter'](), 'Saver');
  const c = F.craft; G.doStage();
  for (let i = 0; i < 60; i++) G.physStep(G.PHYS_DT);
  const rec = JSON.parse(JSON.stringify(G.vesselFromCraft(c, F.t, { id: 7, name: 'Saver' })));
  const k = G.craftFromVessel(rec);
  assert(k.parts.length === c.parts.length && k.stageIdx === c.stageIdx, 'parts/stages');
  const fuel = (x) => x.parts.reduce((a, p) => a + p.fuel + p.solid, 0);
  assert(Math.abs(fuel(k) - fuel(c)) < 1e-9, 'fuel');
  assert(k.parts.filter((p) => p.ignited).length === c.parts.filter((p) => p.ignited).length, 'ignition state');
  assert(Math.hypot(k.pos[0] - c.pos[0], k.pos[1] - c.pos[1]) < 1e-6 && Math.abs(k.xc - c.xc) < 1e-9, 'pose');
});
test('a vessel left in orbit is still there days later; one left falling is lost', () => {
  const s = G.Career.s = G.newSave('sandbox', 2); G.universe();
  const { F } = G;
  G.flightStart(G.PRESETS['Orbiter I'](), 'Keeper');
  const c = F.craft; c.landed = null;
  const r = G.HOME.R + 200000, v = Math.sqrt(G.HOME.mu / r);
  c.pos = [r, 0]; c.vel = [0, v];
  const good = G.vesselFromCraft(c, 0, { id: 1, name: 'Keeper' });
  c.vel = [0, v * 0.9];
  const bad = G.vesselFromCraft(c, 0, { id: 2, name: 'Faller' });
  s.vessels.push(good, bad);
  const lost = G.advanceAll(10 * 86400);
  assert(lost.length === 1 && lost[0] === bad, 'lost ' + lost.map((x) => x.name));
  const o = G.orbitElements(G.HOME, good.s[0], good.s[1], good.s[2], good.s[3], good.t);
  assert(Math.abs(o.rp - r) < 2000 && Math.abs(o.ra - r) < 2000, `orbit drifted: ${o.rp - G.HOME.R}, ${o.ra - G.HOME.R}`);
});
test('flying a stored vessel again picks it up where it is now', () => {
  const s = G.Career.s = G.newSave('sandbox', 3); G.universe();
  const { F } = G;
  G.flightStart(G.PRESETS['Orbiter I'](), 'Returner');
  const c = F.craft; c.landed = null;
  const r = G.HOME.R + 150000, v = Math.sqrt(G.HOME.mu / r);
  c.pos = [r, 0]; c.vel = [0, v];
  const rec = G.vesselFromCraft(c, 0, { id: 5, name: 'Returner' });
  s.vessels.push(rec);
  const expect = G.propagate(r, 0, 0, v, 0, 3600).s;
  G.flightLoadVessel(rec, 3600);
  assert(F.craft.vid === 5 && F.t === 3600 && !s.vessels.includes(rec), 'not loaded');
  assert(Math.hypot(F.craft.pos[0] - expect[0], F.craft.pos[1] - expect[1]) < 50, 'wrong place');
});
test('two free docking ports that meet slowly dock into one craft, and undock again', () => {
  const a = new G.Craft(G.layoutDesign(G.designFromStack(['dockPort', 'pod', 'tankS125', 'gnat'])));
  const b = new G.Craft(G.layoutDesign(G.designFromStack(['dockPort', 'probe', 'tankS125', 'gnat'])));
  a.angle = Math.PI / 2; b.angle = -Math.PI / 2;
  a.pos = [0, 600000]; a.vel = [2000, 0]; b.vel = [2000.2, 0];
  const pa = a.parts.find((p) => p.def.dock), pb = b.parts.find((p) => p.def.dock);
  const tipA = a.toWorld(pa.x, G.portFacing(a, pa) > 0 ? pa.top : pa.bot);
  // place b so its port tip sits 0.3 m above a's
  b.pos = [0, 0];
  const tb = b.toWorld(pb.x, G.portFacing(b, pb) > 0 ? pb.top : pb.bot);
  b.pos = [tipA[0] - tb[0], tipA[1] + 0.3 - tb[1]];
  const dk = G.findDock(a, b);
  assert(dk, 'should be able to dock');
  const na = a.parts.length, nb = b.parts.length;
  G.dockCrafts(a, dk.pa, b, dk.pb);
  assert(a.parts.length === na + nb && new Set(a.parts.map((p) => p.uid)).size === na + nb, 'merged parts');
  assert(G.dockedPairs(a).length === 1, 'one docked pair');
  const gn = a.parts.filter((p) => p.id === 'gnat');
  assert(gn.some((p) => p.inv) && gn.some((p) => !p.inv), 'the docked engine should face the other way');
  for (const e of gn) e.ignited = true;
  a.throttle = 1;
  a.engineStep(0.1, 0);
  assert(Math.abs(a.thrust) < 1, 'opposite engines should cancel, got ' + a.thrust);
  const [p, q] = G.dockedPairs(a)[0];
  const leaving = G.undockParts(a, p, q);
  assert(leaving.length === nb, 'undock should split off the other craft');
});
test('rescue contracts strand an astronaut in orbit, and recovering them completes the contract', () => {
  const s = G.career(21);
  s.milestones.orbit = 1;
  s.vessels = []; s.vesselSeq = 1;
  let c = null;
  for (let i = 0; i < 80 && !c; i++) { const x = G.genContract(s); if (x && x.type === 'rescue') c = x; }
  assert(c, 'no rescue contract offered');
  s.contracts.push(c);
  assert(G.acceptContract(s, c.id) === null, 'accept');
  const v = s.vessels.find((x) => x.id === c.p.vid);
  assert(v && v.kind === 'stranded' && v.crew[0].name === c.p.crewName, 'stranded vessel');
  assert(v.parts.some((p) => p.id === 'dockPort'), 'needs a docking port');
  // its port should face backwards along its orbit, so a chaser can dock
  G.advanceVessel(v, s.ut + 1800);
  const rel = G.wrapPi(v.angle - Math.atan2(v.s[3], v.s[2]));
  assert(Math.abs(Math.abs(rel) - Math.PI) < 0.1, 'port not facing retrograde: ' + rel);
  const done = G.checkContracts(s, { kind: 'recover', crew: G.crewNames(v.crew) });
  G.crewHome(v.crew, v.flags);
  assert(done.includes(c) && s.crew.some((m) => m.name === c.p.crewName && m.status === 'available'), 'not rescued');
  G.Career.s = null;
});
test('tutorials are set up and sound is safe without an audio device', () => {
  assert(G.TUTORIALS.length === 4 && G.TUTORIALS.every((t) => t.steps.length >= 4), 'tutorials');
  assert(G.TUTORIALS[0].steps[0].done({ stageIdx: 1 }) && !G.TUTORIALS[0].steps[0].done({ stageIdx: 0 }), 'first step check');
  G.playSound('boom'); G.playSound('stage');
});

console.log('Saving through interruptions');
/* Simulate closing the page: throw away everything in memory and load the save from storage again. */
const reloadGame = () => { G.F.running = false; G.Career.s = null; return G.loadSave(); };
test('a flight interrupted mid-air comes back as a vessel, with its crew still aboard', () => {
  const { F } = G;
  G.setSave(G.newSave('career', 31));
  const s = G.Career.s;
  G.flightStart(G.PRESETS['Orbiter I'](), 'Interrupted', { t0: 0 });
  const cm = s.crew[0];
  cm.status = 'flying';
  F.crew = [{ id: cm.id, name: cm.name, pod: F.craft.parts.find((p) => p.def.pod).uid }];
  G.persist();
  const c = F.craft; c.landed = null;
  const r = G.HOME.R + 120000;
  c.pos = [r, 0]; c.vel = [0, Math.sqrt(G.HOME.mu / r)]; F.t = 5000;
  G.saveCheckpoint();
  const s2 = reloadGame();
  const v = s2.vessels.find((x) => x.name === 'Interrupted');
  assert(v, 'vessel not restored');
  assert(Math.abs(Math.hypot(v.s[0], v.s[1]) - r) < 1 && s2.ut === 5000, 'wrong place or time');
  assert(v.crew.length === 1 && s2.crew[0].status === 'flying', 'crew should still be aboard');
  assert(!G.Store.get('flight', null), 'checkpoint should be used up');
  assert(G.Career.restoreNote && /Interrupted/.test(G.Career.restoreNote), 'player should be told');
});
test('nearby vessels loaded during the flight are not lost if the game closes', () => {
  const { F } = G;
  G.setSave(G.newSave('sandbox', 32));
  const s = G.universe();
  G.flightStart(G.PRESETS['Orbiter I'](), 'Chaser', { t0: 0 });
  const c = F.craft; c.landed = null;
  const r = G.HOME.R + 150000, v = Math.sqrt(G.HOME.mu / r);
  c.pos = [r, 0]; c.vel = [0, v];
  const st = G.spawnStranded(s, G.HOME, 150000, 'Odile Brandt', 0.0004);
  G.persist();
  for (let i = 0; i < 3; i++) G.flightUpdate(1 / 60);
  assert(F.others.length === 1 && !s.vessels.includes(st), 'the capsule should be loaded next to us');
  G.persist(); // a save written mid-flight no longer lists the loaded capsule...
  G.saveCheckpoint(); // ...but the checkpoint does
  const s2 = reloadGame();
  assert(s2.vessels.some((x) => x.name === "Brandt's Capsule") && s2.vessels.some((x) => x.name === 'Chaser'), s2.vessels.map((x) => x.name).join());
});
test('astronauts stuck as "flying" with no vessel are freed on load', () => {
  G.setSave(G.newSave('career', 33));
  G.Career.s.crew[1].status = 'flying';
  G.persist();
  G.clearCheckpoint();
  const s2 = reloadGame();
  assert(s2.crew[1].status === 'available', 'still stuck');
});
test('ending a flight normally or starting a new game leaves no stale checkpoint', () => {
  const { F } = G;
  G.setSave(G.newSave('sandbox', 34));
  G.flightStart(G.PRESETS['Sky Hopper'](), 'Hop', { t0: 0 });
  G.saveCheckpoint();
  assert(G.Store.get('flight', null), 'checkpoint should exist mid-flight');
  G.setSave(G.newSave('career', 35));
  assert(!G.Store.get('flight', null), 'new game should clear it');
  F.running = false;
  G.Career.s = null;
});

console.log('Part settings, staging and part menu');
test('career mode starts with landing legs', () => {
  G.Career.s = G.newSave('career', 61);
  assert(G.partUnlocked('legs'), 'legs locked');
  G.Career.s = null;
});
test('tank load, thrust limits and parachute altitude change how the craft behaves', () => {
  const d = G.PRESETS['Orbiter I']();
  const full = G.analyzeDesign(d).total;
  const tank = d.parts.find((p) => p.id === 'tankM');
  G.setPartCfg(d, tank.uid, 'fill', 50);
  const half = G.analyzeDesign(d);
  assert(half.total < full - 300, `Δv ${full} -> ${half.total}`);
  assert(Math.abs(half.parts.find((p) => p.uid === tank.uid).fuel - 1) < 1e-9, 'tank should hold 1 t');
  const ox = d.parts.find((p) => p.id === 'ox');
  G.setPartCfg(d, ox.uid, 'thrustLimit', 50);
  const c = new G.Craft(G.layoutDesign(d));
  const e = c.parts.find((p) => p.id === 'ox'); e.ignited = true; c.throttle = 1;
  assert(Math.abs(c.engineStep(0.1, 0) - 140) < 0.5, 'thrust at 50% should be 140 kN, got ' + c.thrust);
  const d2 = G.designFromStack(['chute', 'pod']);
  G.setPartCfg(d2, d2.parts[0].uid, 'deployAlt', 150);
  assert(new G.Craft(G.layoutDesign(d2)).chuteAlt === 150, 'chute altitude');
  // solid booster at 50% burns about twice as long
  const s1 = G.designFromStack(['pod', 'srb']), s2 = G.designFromStack(['pod', 'srb']);
  G.setPartCfg(s2, s2.parts[1].uid, 'srbLimit', 50);
  const b1 = G.analyzeDesign(s1).rows[0].burn, b2 = G.analyzeDesign(s2).rows[0].burn;
  assert(Math.abs(b2 / b1 - 2) < 0.1, `burn ${b1} -> ${b2}`);
});
test('dropping a part between two stages makes a new stage there', () => {
  const m = G.normalizeStages({ 1: 0, 2: 0, 3: 1, 4: 2 });
  m[2] = 0.5;
  const n = G.normalizeStages(m);
  assert(n[1] === 0 && n[2] === 1 && n[3] === 2 && n[4] === 3, JSON.stringify(n));
});
test('clicking the screen finds the right part, and a single decoupler can be fired', () => {
  const { F } = G;
  G.flightStart(G.PRESETS['Orbiter I'](), 'Clicky');
  const c = F.craft;
  F.W = 1200; F.H = 800; F.zoom = 10; c.angle = 0.7; F.viewRot = 0.3;
  const pod = c.parts.find((p) => p.def.pod);
  // forward-project the pod's centre to the screen, as the renderer does
  const w = c.toWorld(pod.x, (pod.top + pod.bot) / 2), dx = w[0] - c.pos[0], dy = w[1] - c.pos[1];
  const rx = dx * Math.cos(0.3) - dy * Math.sin(0.3), ry = dx * Math.sin(0.3) + dy * Math.cos(0.3);
  const sx = F.W / 2 + rx * F.zoom, sy = F.H / 2 - ry * F.zoom;
  const [lx, ly] = G.screenToCraft(c, sx, sy);
  assert(Math.abs(lx - pod.x) < 1e-6 && Math.abs(ly - (pod.top + pod.bot) / 2) < 1e-6, 'round trip');
  assert(G.partAt(c, sx, sy) === pod, 'should hit the capsule');
  const n = c.parts.length, dec = c.parts.find((p) => p.def.decoupler);
  G.fireDecoupler(c, dec);
  assert(c.parts.length < n && !c.parts.includes(dec) && F.debris.length === 1, 'decoupler should drop the lower stage');
});

console.log('Engine clusters');
test('a twin mount holds two engines side by side; symmetry fills the second slot', () => {
  const d = G.designFromStack(['pod', 'tankXL', 'twinMountL']);
  const mount = d.parts.find((p) => p.id === 'twinMountL').uid;
  const uids = G.attachPart(d, 'ox', mount, 'slot:0', 0, 0, true);
  assert(uids.length === 2, 'symmetry should add two engines');
  const geo = G.layoutDesign(d), m = geo.find((g) => g.id === 'twinMountL');
  const ox = geo.filter((g) => g.id === 'ox').sort((a, b) => a.x - b.x);
  assert(Math.abs(ox[0].x + 1) < 1e-9 && Math.abs(ox[1].x - 1) < 1e-9, 'engines at ±1 m: ' + ox.map((e) => e.x));
  assert(ox.every((e) => Math.abs(e.top - m.bot) < 1e-9), 'engines hang under the mount');
  const a = G.analyzeDesign(d);
  assert(a.valid && !a.warnings.some((w) => /off-centre/.test(w.text)), JSON.stringify(a.warnings));
  const first = a.stages[0].map((u) => geo.find((g) => g.uid === u).id);
  assert(first.filter((x) => x === 'ox').length === 2, 'both engines light together');
  const c = new G.Craft(G.layoutDesign(d));
  for (const e of c.engines) e.ignited = true;
  c.throttle = 1;
  assert(Math.abs(c.engineStep(0.1, 0) - 560) < 0.5 && Math.abs(c.thrustTorque) < 1e-6, `thrust ${c.thrust}, torque ${c.thrustTorque}`);
});
test('one engine on a twin mount pushes off-centre and gets a warning', () => {
  const d = G.designFromStack(['pod', 'tankXL', 'twinMountL']);
  G.attachPart(d, 'ox', d.parts.find((p) => p.id === 'twinMountL').uid, 'slot:1', 0, 0, false);
  assert(G.analyzeDesign(d).warnings.some((w) => /off-centre/.test(w.text)), 'expected a warning');
});
test('a quad mount takes four engines, and the Cluster Lifter reaches orbit', () => {
  const d = G.designFromStack(['pod', 'tankT12', 'quadMount']);
  const m = d.parts.find((p) => p.id === 'quadMount').uid;
  G.attachPart(d, 'gnat', m, 'slot:0', 0, 0, true);
  G.attachPart(d, 'gnat', m, 'slot:1', 0, 0, true);
  const xs = G.layoutDesign(d).filter((g) => g.id === 'gnat').map((g) => g.x).sort((a, b) => a - b);
  assert(xs.length === 4 && Math.abs(xs[0] + 1.875) < 1e-9 && Math.abs(xs[3] - 1.875) < 1e-9, xs.join());
  const r = flyToOrbit(G.PRESETS['Cluster Lifter'](), 'Cluster Lifter');
  assert(!r.dead && r.phase === 'done' && r.pe > 70000 && r.maxSpin < 0.6, `phase ${r.phase}, Pe ${r.pe.toFixed(0)}, spin ${r.maxSpin.toFixed(2)}`);
});

console.log('\nNew parts');
/* A craft dropped into the air at a given height and speed (falling straight down, nose up). */
function dropTest(ids, alt, speed, setup) {
  const { F } = G;
  const d = G.designFromStack(ids);
  if (setup) setup(d);
  G.flightStart(d, 'Drop');
  const c = F.craft; c.landed = null; F.t = 0; F.debris = []; F.sas = 'off';
  c.pos = [0, G.HOME.R + alt]; c.vel = [0, -speed]; c.angle = Math.PI / 2; c.angVel = 0;
  return c;
}
function runFor(c, secs, each) {
  const { F } = G;
  for (let i = 0; i < secs / G.PHYS_DT && !c.dead && !c.landed; i++) {
    c.ctrl = 0;
    G.stepCraft(c, G.PHYS_DT, true);
    F.t += G.PHYS_DT;
    if (each) each(c);
  }
  return c;
}
test('every new part has a cost, a research node and a picture-able kind', () => {
  for (const id of ['shield3', 'bloom', 'chuteDrogue', 'chuteBig', 'airbrake', 'hearth', 'whisper', 'spindle', 'puff', 'gasTank', 'gasDrum',
    'heron', 'cabin', 'fairing2', 'fairing3', 'strut', 'batteryDisc', 'batteryBank', 'fuelCell', 'fuelCellL']) {
    const d = G.PART_DEFS[id];
    assert(d && d.cost > 100 || id === 'strut', id + ' cost');
    assert(G.PART_TECH[id], id + ' research');
  }
});
test('a main canopy opened too fast tears off, but a drogue first brings the capsule down safely', () => {
  const { F } = G;
  // main alone, set to open fully high up while falling fast
  let c = dropTest(['chute', 'pod'], 2800, 380, (d) => G.setPartCfg(d, d.parts[0].uid, 'deployAlt', 3000));
  G.doStage();
  runFor(c, 120);
  const main = c.parts.find((p) => p.def.chute);
  assert(main.torn && c.dead, `torn ${main.torn}, dead ${c.dead}`);
  // drogue opens first, the main later and lower
  c = dropTest(['chuteDrogue', 'pod'], 9000, 300, (d) => {
    const pod = d.parts.find((p) => p.id === 'pod').uid;
    G.attachPart(d, 'chuteRadial', pod, 'side', 1, 0.3, true);
  });
  for (const p of c.chutes) if (p.def.drogue) p.open = true;
  let mainOpened = false;
  runFor(c, 2500, (k) => {
    const v = Math.hypot(k.vel[0], k.vel[1]);
    if (!mainOpened && v < 120) { mainOpened = true; for (const p of k.chutes) p.open = true; }
  });
  const torn = c.chutes.some((p) => p.torn);
  assert(!c.dead && c.landed && !torn, `dead ${c.dead}, landed ${!!c.landed}, torn ${torn}`);
});
test('air brakes add drag', () => {
  const speedAfter = (on) => {
    const c = dropTest(['pod', 'tankM'], 30000, 600, (d) => G.attachPart(d, 'airbrake', d.parts[1].uid, 'side', 1, 0.5, true));
    if (on) G.toggleBrakes();
    assert(c.brakes.length === 2 && c.brakes.every((p) => !!p.brake === on), 'brakes');
    runFor(c, 20);
    return Math.hypot(c.vel[0], c.vel[1]);
  };
  const off = speedAfter(false), on = speedAfter(true);
  assert(on < off - 20, `brakes off ${off.toFixed(0)}, on ${on.toFixed(0)} m/s`);
});
test('an inflated shield slows the capsule high up and keeps it cool', () => {
  const { F } = G;
  const go = (inflate) => {
    const d = G.designFromStack(['chute', 'pod', 'bloom']);
    G.flightStart(d, 'Bloom');
    const c = F.craft; c.landed = null; F.t = 0; F.debris = [];
    const r = G.HOME.R + 69000, fpa = -0.25, v = 3200;
    c.pos = [0, r]; c.vel = [v * Math.cos(fpa), v * Math.sin(fpa)];
    c.angle = Math.atan2(c.vel[1], c.vel[0]) + Math.PI;
    const sh = c.parts.find((p) => p.def.inflate);
    if (inflate) { sh.inflated = true; c.recompute(); }
    F.sas = 'off';
    let peak = 0, slowAt = 0;
    for (let i = 0; i < 60 * 400 && !c.dead; i++) {
      c.ctrl = 0;
      G.stepCraft(c, G.PHYS_DT, true);
      F.t += G.PHYS_DT;
      for (const p of c.parts) if (p.def.pod) peak = Math.max(peak, p.temp);
      const alt = Math.hypot(...c.pos) - G.HOME.R;
      if (!slowAt && Math.hypot(...c.vel) < 1000) slowAt = alt;
      if (alt < 15000) break;
    }
    return { dead: c.dead, peak, slowAt, w: c.width };
  };
  const packed = go(false), open = go(true);
  assert(open.w > 5.9, 'inflated width ' + open.w);
  assert(!open.dead && open.peak < 1500, `inflated: dead ${open.dead}, peak ${open.peak.toFixed(0)} K`);
  assert(open.slowAt > packed.slowAt + 5000, `slowed below 1 km/s at ${open.slowAt.toFixed(0)} m (packed ${packed.slowAt.toFixed(0)} m)`);
});
test('the ion drive burns argon and charge, and stops on a flat battery', () => {
  const { F } = G;
  const d = G.designFromStack(['probe', 'batteryBank', 'gasDrum', 'whisper']);
  const a = G.analyzeDesign(d);
  assert(a.rows[0].dv > 8000, 'ion Δv ' + a.rows[0].dv.toFixed(0));
  G.flightStart(d, 'Ion');
  const c = F.craft; c.landed = null;
  c.pos = [0, G.HOME.R + 300000]; c.vel = [Math.sqrt(G.HOME.mu / (G.HOME.R + 300000)), 0];
  G.doStage(); c.throttle = 1;
  const gas0 = c.propTotal('gas'), ec0 = G.ecTotal(c);
  const T = c.engineStep(1, 0);
  assert(Math.abs(T - 2.5) < 0.01, 'thrust ' + T);
  assert(c.propTotal('gas') < gas0 && G.ecTotal(c) < ec0 - 8, `gas ${gas0}->${c.propTotal('gas')}, charge ${ec0}->${G.ecTotal(c)}`);
  G.ecDrain(c, 1e9);
  assert(c.engineStep(1, 0) === 0 && !c.engineHasFuel(c.engines[0]), 'thrust with a flat battery');
});
test('monoprop engines, aerospikes and atomic engines behave as described', () => {
  const { F } = G;
  // a monoprop engine burns the capsule's monopropellant
  const d = G.designFromStack(['pod', 'puff']);
  G.flightStart(d, 'Puff');
  const c = F.craft; G.doStage(); c.throttle = 1;
  const m0 = c.monoTotal();
  assert(c.engineStep(1, 1) > 0 && c.monoTotal() < m0, 'mono');
  const spike = G.PART_DEFS.spindle, ox = G.PART_DEFS.ox, nuke = G.PART_DEFS.hearth;
  assert(spike.ispSL / spike.ispVac > ox.ispSL / ox.ispVac, 'aerospike keeps its efficiency at sea level');
  assert(nuke.ispVac > 2 * G.PART_DEFS.wren.ispVac, 'atomic engine efficiency');
});
test('a fairing covers its payload, then splits open and leaves', () => {
  const { F } = G;
  const d = G.designFromStack(['probe', 'tankM125', 'fairing2', 'tankM', 'kestrel', 'decoupler', 'tankL', 'ox']);
  const t = d.parts.find((p) => p.id === 'tankM125').uid;
  G.attachPart(d, 'solar', t, 'side', 1, 0.2, true);
  const fair = d.parts.find((p) => p.id === 'fairing2').uid;
  G.setPartCfg(d, fair, 'fairH', 3);
  const a = G.analyzeDesign(d);
  const fStage = a.stages.findIndex((s) => s.includes(fair));
  const kStage = a.stages.findIndex((s) => s.some((u) => G.designFromStack && a.parts.find((p) => p.uid === u && p.id === 'kestrel')));
  assert(fStage === kStage + 1, `fairing stage ${fStage}, upper engine stage ${kStage}`);
  G.flightStart(d, 'Payload');
  const c = F.craft;
  const enclosed = c.parts.filter((p) => p.enclosed).map((p) => p.id).sort();
  assert(enclosed.join() === 'probe,solar,solar,tankM125', 'enclosed ' + enclosed.join());
  assert(c.aeroWidth < c.width + 1e-9 && Math.abs(c.aeroWidth - 2.3) < 1e-9, `aero width ${c.aeroWidth}`);
  const m0 = c.M, deb = F.debris.length;
  c.landed = null;
  while (c.stageIdx <= fStage) G.doStage();
  assert(!c.shells.length && c.M < m0 - 0.1 && F.debris.length >= deb + 2, `mass ${m0} -> ${c.M}, debris ${F.debris.length}`);
  assert(c.parts.every((p) => !p.enclosed), 'nothing enclosed after');
  assert(G.stageLabel([fair], (u) => c.byUid.get(u) || a.parts.find((p) => p.uid === u)) === 'Open fairing', 'label');
});
test('a fuel cell makes power from fuel when the batteries are low', () => {
  const { F } = G;
  const d = G.designFromStack(['probe', 'batteryDisc', 'tankM125', 'fuelCellL', 'gnat']);
  G.flightStart(d, 'Cell');
  const c = F.craft;
  G.ecDrain(c, 1e9);
  const f0 = c.parts.find((p) => p.def.fuel).fuel;
  for (let i = 0; i < 50; i++) G.electricStep(c, 0.1, 0, 0);
  assert(G.ecTotal(c) > 40 && c.parts.find((p) => p.def.fuel).fuel < f0, `charge ${G.ecTotal(c)}`);
  c.cells[0].cellOff = true;
  const e1 = G.ecTotal(c);
  for (let i = 0; i < 50; i++) G.electricStep(c, 0.1, 0, 0);
  assert(G.ecTotal(c) < e1, 'switched off');
});
test('the Heron and a crew cabin seat seven, and new part states survive a save', () => {
  const { F } = G;
  const d = G.designFromStack(['chuteBig', 'heron', 'cabin', 'shield3']);
  assert(G.designSeats(d) === 7, 'seats ' + G.designSeats(d));
  G.flightStart(G.designFromStack(['probe', 'gasDrum', 'fairing2', 'tankM', 'bloom', 'whisper']), 'Save');
  const c = F.craft;
  c.parts.find((p) => p.def.inflate).inflated = true;
  c.parts.find((p) => p.def.fairing).shell = false;
  c.parts.find((p) => p.def.gas).gas = 0.123;
  const c2 = G.craftFromVessel(JSON.parse(JSON.stringify(G.vesselFromCraft(c, F.t, { id: 1, name: 'x' }))));
  assert(c2.parts.find((p) => p.def.inflate).inflated && !c2.shells.length && Math.abs(c2.propTotal('gas') - 0.123) < 1e-9, 'states');
});

console.log('\nPlanes and rovers');
/* Fly a plane off the runway: full throttle, then hold the nose a little above the horizon. */
function flyPlane(design, secs, pitch = 0.2) {
  const { F } = G;
  G.flightStart(design, 'Plane', { site: 'runway' });
  const c = F.craft;
  G.doStage(); c.throttle = 1; F.sas = 'off';
  let maxAlt = 0, liftoffV = 0;
  for (let i = 0; i < secs / G.PHYS_DT && !c.dead; i++) {
    const up = Math.atan2(c.pos[1], c.pos[0]), horiz = up - Math.PI / 2;
    const v = Math.hypot(...c.vel);
    const err = G.wrapPi((v > 55 ? horiz + pitch : horiz) - c.angle);
    c.ctrl = G.clamp(err * 3 - c.angVel * 2, -1, 1);
    G.stepCraft(c, G.PHYS_DT, true);
    F.t += G.PHYS_DT;
    const alt = Math.hypot(...c.pos) - G.HOME.R;
    if (!liftoffV && alt > 15) liftoffV = v;
    maxAlt = Math.max(maxAlt, alt);
  }
  return { c, maxAlt, liftoffV };
}
test('the runway is flat and the Swallow Jet starts on it, wheels down, nose east', () => {
  const { F } = G;
  for (let d = G.RUNWAY_START; d <= G.RUNWAY_END; d += 0.0002) assert(Math.abs(G.terrainH(G.HOME, G.PAD_PHI - d) - 4) < 1e-6, 'bump at ' + d);
  G.flightStart(G.PRESETS['Swallow Jet'](), 'Swallow', { site: 'runway' });
  const c = F.craft, phi = Math.atan2(c.pos[1], c.pos[0]);
  assert(c.landed && c.landed.wheels && phi < G.PAD_PHI - G.RUNWAY_START + 1e-4 && phi > G.PAD_PHI - G.RUNWAY_END, 'placement');
  assert(Math.abs(G.wrapPi(c.angle - (phi - Math.PI / 2))) < 1e-9, 'nose along the runway');
  for (const w of c.wheels) { const p = c.toWorld(...G.wheelPoint(w)); assert(Math.abs(Math.hypot(...p) - G.HOME.R - 4) < 0.05, 'wheel height ' + (Math.hypot(...p) - G.HOME.R)); }
});
test('wings lift: the Swallow Jet takes off from the runway and climbs', () => {
  const r = flyPlane(G.PRESETS['Swallow Jet'](), 60);
  assert(!r.c.dead && r.maxAlt > 1500, `dead ${r.c.dead}, max altitude ${r.maxAlt.toFixed(0)} m`);
  assert(r.liftoffV > 50 && r.liftoffV < 250, 'liftoff speed ' + r.liftoffV.toFixed(0));
  assert(G.liftCoef(0.1) > 0.6 && G.liftCoef(0.1) < 0.65 && G.liftCoef(-0.1) < 0 && G.liftCoef(0.6) < G.liftCoef(0.24), 'lift curve');
});
test('without wings the same plane cannot take off', () => {
  const d = G.PRESETS['Swallow Jet']();
  G.removePartTree(d, d.parts.find((p) => p.id === 'wingL').uid);
  const r = flyPlane(d, 25);
  assert(r.maxAlt < 30, 'max altitude ' + r.maxAlt.toFixed(0));
});
test('jets need oxygen-rich air and an intake', () => {
  const { F } = G;
  G.flightStart(G.PRESETS['Swallow Jet'](), 'Swallow', { site: 'runway' });
  const c = F.craft, e = c.engines[0];
  c.air = { rho: 1.2, v: 0, oxygen: true };
  assert(G.jetFactor(c, e) > 0.99, 'at sea level ' + G.jetFactor(c, e));
  c.air = { rho: 1.2, v: 0, oxygen: false };
  assert(G.jetFactor(c, e) === 0, 'no oxygen');
  c.air = { rho: 0, v: 0, oxygen: true };
  assert(G.jetFactor(c, e) === 0, 'vacuum');
  c.air = { rho: 1.2, v: 600, oxygen: true };
  assert(G.jetFactor(c, e) === 0, 'too fast for a turbofan');
  const d = G.PRESETS['Swallow Jet']();
  for (const p of d.parts.filter((q) => q.id === 'intakeRad')) G.removePartTree(d, p.uid);
  G.flightStart(d, 'NoIntake', { site: 'runway' });
  F.craft.air = { rho: 1.2, v: 0, oxygen: true };
  assert(G.jetFactor(F.craft, F.craft.engines[0]) === 0, 'no intake');
});
test('a rover drives along the runway, brakes to a stop and settles', () => {
  const { F } = G;
  G.flightStart(G.PRESETS['Dune Rover'](), 'Rover', { site: 'runway' });
  const c = F.craft, p0 = c.pos.slice();
  assert(c.landed && c.landed.wheels && c.motors.length === 2, 'on its wheels');
  F.drive = 1; F.sas = 'off';
  for (let i = 0; i < 20 / G.PHYS_DT && !c.dead; i++) { c.ctrl = 0; G.stepCraft(c, G.PHYS_DT, true); F.t += G.PHYS_DT; }
  const moved = Math.hypot(c.pos[0] - p0[0], c.pos[1] - p0[1]), v = Math.hypot(...c.vel);
  assert(!c.dead && moved > 100 && v > 8 && c.rolling, `moved ${moved.toFixed(0)} m, speed ${v.toFixed(1)}`);
  assert(c.pos[0] > p0[0], 'drove east');
  F.drive = 0; G.toggleBrakes();
  for (let i = 0; i < 20 / G.PHYS_DT && !c.dead && !c.landed; i++) { c.ctrl = 0; G.stepCraft(c, G.PHYS_DT, true); F.t += G.PHYS_DT; }
  assert(!c.dead && c.landed && c.landed.wheels, 'settled');
  // reversing works too, and drives it back west
  const p1 = c.pos.slice();
  G.toggleBrakes(); F.drive = -1;
  for (let i = 0; i < 5 / G.PHYS_DT && !c.dead; i++) { c.ctrl = 0; G.stepCraft(c, G.PHYS_DT, true); F.t += G.PHYS_DT; }
  F.drive = 0;
  assert(c.pos[0] < p1[0] - 5, 'reversed');
});
test('a gentle touchdown on the gear rolls on; a hard one breaks the gear off; gear up means a belly landing', () => {
  const { F } = G;
  const drop = (vy, gearUp) => {
    G.flightStart(G.PRESETS['Swallow Jet'](), 'Lander', { site: 'runway' });
    const c = F.craft;
    if (gearUp) G.toggleGear();
    c.landed = null;
    const phi = Math.atan2(c.pos[1], c.pos[0]);
    c.pos = c.pos.map((x) => x * (1 + 3 / Math.hypot(...c.pos)));
    const east = [Math.sin(phi), -Math.cos(phi)], up = [Math.cos(phi), Math.sin(phi)];
    c.vel = [east[0] * 70 - up[0] * vy, east[1] * 70 - up[1] * vy];
    F.sas = 'off';
    for (let i = 0; i < 6 / G.PHYS_DT && !c.dead; i++) { c.ctrl = 0; G.stepCraft(c, G.PHYS_DT, true); F.t += G.PHYS_DT; }
    return c;
  };
  const soft = drop(3, false);
  assert(!soft.dead && soft.wheels.length === 2, `soft: dead ${soft.dead}, wheels ${soft.wheels.length}`);
  const hard = drop(14, false);
  assert(hard.wheels.length < 2, 'hard landing kept its gear');
  const belly = drop(3, true);
  assert(belly.dead, 'belly landing at 70 m/s survived');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
