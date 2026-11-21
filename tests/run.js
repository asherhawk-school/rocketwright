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
for (const f of ['data.js', 'vessel.js', 'career/career.js', 'career/science.js', 'career/tech.js', 'career/contracts.js', 'flight.js']) src += fs.readFileSync(path.join(root, 'js', f), 'utf8') + '\n';
// expose a few lexical globals for the tests
src += '\nthis.__g = { F, PRESETS, PART_DEFS, HOME, MOON, newDesign, attachPart, removePartTree, extractSubtree, insertSubtree, designFromStack, migrateDesign, layoutDesign, analyzeDesign, resolveStages, stageListFrom, autoStages, Craft, cloneParts, simulateStages, flightStart, doStage, stepCraft, railsStep, orbitElements, soiBody, bodyPos, bodyState, wrapPi, clamp, PHYS_DT, WARPS, isEngine, BODIES, BODY_BY_ID, SUN, OCHRE, GALE, TEMPEST, predictPath, loadMilestones, Store, physStep, findEncounter, Career, newSave, designCost, lockedParts, research, PART_TECH, TECH_NODES, runExperiment, creditResult, transmit, subjectCap, situationOf, refreshContracts, acceptContract, checkContracts, genContract, reachableBodies, recoveryFactor, flightUpdate, HOME, MOON, DAY, explode, partUnlocked };';
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
  G.flightStart(G.PRESETS['Sky Hopper'](), 'Hopper', { t0: s.ut, crewId: s.crew[0].id });
  G.doStage();
  for (let i = 0; i < 60 * 60 && c.state === 'active'; i++) G.flightUpdate(1 / 60);
  assert(c.state === 'done', 'contract not completed; alt ' + (Math.hypot(...F.craft.pos) - 500000).toFixed(0));
  assert(s.milestones.liftoff, 'liftoff milestone should be in the career save');
});
test('a crash loses the astronaut and reputation', () => {
  const s = career(8);
  const { F } = G;
  G.flightStart(G.PRESETS['Sky Hopper'](), 'Hopper', { t0: 0, crewId: s.crew[1].id });
  s.crew[1].status = 'flying';
  s.rep = 20;
  G.explode(F.craft, true, 50);
  assert(s.crew[1].status === 'lost' && s.rep === 10, `${s.crew[1].status}, rep ${s.rep}`);
  G.Career.s = null;
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
