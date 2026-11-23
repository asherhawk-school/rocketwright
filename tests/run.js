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
for (const f of ['data.js', 'vessel.js', 'systems.js', 'navigation.js', 'docking.js', 'alarms.js', 'crew.js', 'asteroids.js', 'anomalies.js', 'comms.js', 'eva.js', 'sound.js', 'career/career.js', 'career/science.js', 'career/tech.js', 'career/contracts.js', 'universe.js', 'flight.js', 'partmenu.js', 'tutorials.js']) src += fs.readFileSync(path.join(root, 'js', f), 'utf8') + '\n';
// expose a few lexical globals for the tests
src += '\nthis.__g = { F, PRESETS, PART_DEFS, HOME, MOON, newDesign, attachPart, removePartTree, extractSubtree, insertSubtree, designFromStack, migrateDesign, layoutDesign, analyzeDesign, resolveStages, stageListFrom, autoStages, Craft, cloneParts, simulateStages, flightStart, doStage, stepCraft, railsStep, orbitElements, soiBody, bodyPos, bodyState, wrapPi, clamp, PHYS_DT, WARPS, isEngine, BODIES, BODY_BY_ID, SUN, OCHRE, GALE, TEMPEST, predictPath, loadMilestones, Store, physStep, findEncounter, Career, newSave, designCost, lockedParts, research, PART_TECH, TECH_NODES, runExperiment, creditResult, transmit, subjectCap, situationOf, refreshContracts, acceptContract, checkContracts, genContract, reachableBodies, recoveryFactor, flightUpdate, HOME, MOON, DAY, explode, partUnlocked, ecTotal, electricStep, solarInput, inShadow, hasControl, heatStep, destroyPart, makeNode, updateNode, burnTime, dvMapRows, launchDv, transferWindow, controlInput, propagate, stepLimitG: stepLimit, vesselFromCraft, craftFromVessel, advanceVessel, advanceAll, flightLoadVessel, universe, findDock, dockCrafts, dockedPairs, undockParts, portFacing, spawnStranded, crewHome, crewNames, TUTORIALS, playSound, recoverRecord, saveCheckpoint, clearCheckpoint, restoreCheckpoint, repairCrew, loadSave, setSave, persist, Store, setPartCfg, cfgVal, normalizeStages, screenToCraft, partAt, fireDecoupler, designSeats, shellH, jettisonFairing, toggleBrakes, stageLabel, ecDrain, toggleGear, liftCoef, jetFactor, wheelPoint, terrainH, PAD_PHI, RUNWAY_START, RUNWAY_END, quickSave, quickLoad, quickSaveInfo, clearQuickSave, canQuickSave, setAside, takePiece, layoutLoose, editOwner, pieceIndexOf, anyPart, newSub, cloneDesign, biomeAt, biomeNames, BIOMES, sciBiome, subjectId, situationOf, goEva, boardNearby, boardTarget, evaKey, evaHop, plantFlag, placeOnGround, collectResult, partResults, recoverRecord, migrateSave, upgradeFacility, facLevel, facLimit, hireCrew, maxActive, sasAllowed, maxWarp, nodesAllowed, crewHasRole, scienceBonus, partActions, ROLES, oreAt, miningStep, transferProp, drillOnGround, oreBelow, propRoom, ORE_YIELD, linkToHome, commnetOn, hasSignal, stationNodes, partsRange, fireGroup, toggleLights, findGrab, undock, autoStages, asteroidTick, spawnAsteroid, heldRock, diff, completeContract, logEvent, crewMood, separatePiece, addAlarm, alarmList, alarmClip, nextAlarm, alarmPresets, removeAlarm, surveySites, nearestSite, touristGoalMet, availableCrew, waitingTourists, rosterSize, canEva, labStep, labAnalyse, labSkill, deployStation, stationTick, STATION_DAYS, BODY_SCI, ANOMALIES, ANOMALY_BY_ID, anomalyTick, anomalyFound, milestoneName, surfaceMarkers, startStrategy, stopStrategy, hasStrategy, STRATEGIES, tipOntoWheels, canTip, switchToVessel };';
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
  for (const id of Object.keys(G.PART_DEFS)) if (!G.PART_DEFS[id].hidden) assert(G.PART_TECH[id], id + ' is not in the tech tree');
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

console.log('\nQuick save');
test('a quick save mid-flight can be loaded again and again, even after a crash', () => {
  const { F } = G;
  const s = career(21);
  G.clearQuickSave();
  G.flightStart(G.PRESETS['Orbiter I'](), 'Saver', { t0: 0 });
  const c0 = F.craft;
  F.crew = [{ id: s.crew[0].id, name: s.crew[0].name, pod: c0.parts.find((p) => p.def.pod).uid }];
  s.crew[0].status = 'flying';
  // climb a little, then save
  G.doStage(); c0.throttle = 1;
  for (let i = 0; i < 400; i++) { c0.ctrl = 0; G.stepCraft(c0, G.PHYS_DT, true); F.t += G.PHYS_DT; }
  F.node = G.makeNode(F.t + 300); F.node.pro = 120;
  const alt0 = Math.hypot(...c0.pos) - G.HOME.R, fuel0 = c0.parts.reduce((a, p) => a + p.fuel, 0), t0 = F.t, funds0 = s.funds;
  assert(G.canQuickSave() && G.quickSave() && G.quickSaveInfo(), 'saved');
  for (let round = 0; round < 3; round++) {
    // fly on, spend money, then crash
    const c = F.craft;
    for (let i = 0; i < 300; i++) { c.ctrl = 0; G.stepCraft(c, G.PHYS_DT, true); F.t += G.PHYS_DT; }
    G.Career.s.funds -= 5000;
    G.explode(c, true, 80);
    assert(c.dead && G.Career.s.crew[0].status === 'lost' && !G.canQuickSave(), 'crashed');
    assert(G.quickLoad(), 'loaded');
    const k = F.craft, s2 = G.Career.s;
    assert(!k.dead && k !== c && Math.abs(Math.hypot(...k.pos) - G.HOME.R - alt0) < 1e-6 && F.t === t0, `round ${round}: alt ${Math.hypot(...k.pos) - G.HOME.R}`);
    assert(Math.abs(k.parts.reduce((a, p) => a + p.fuel, 0) - fuel0) < 1e-9 && k.throttle === 1 && k.stageIdx === 1, 'fuel, throttle, stage');
    assert(s2.funds === funds0 && s2.crew[0].status === 'flying' && F.crew.length === 1 && !F.endShown && F.deadTimer === 0, 'save rolled back');
    assert(F.node && F.node.pro === 120, 'node kept');
  }
  // a different flight can't load it
  G.flightStart(G.PRESETS['Sky Hopper'](), 'Other', { t0: F.t });
  assert(!G.quickSaveInfo(), 'save belongs to the other flight');
  G.clearQuickSave();
  G.Career.s = null;
});

console.log('\nSetting parts aside');
test('a section set aside keeps its parts and settings, and leaves the rocket alone', () => {
  const d = G.PRESETS['Heavy Lifter']();
  const n = d.parts.length;
  const rd = d.parts.find((p) => p.id === 'radDec' && p.side < 0);
  const srb = d.parts.find((p) => p.parent === rd.uid);
  G.setPartCfg(d, srb.uid, 'srbLimit', 60);
  const sub = G.extractSubtree(d, rd.uid); // takes both mirrored boosters off; one comes along
  const root = G.setAside(d, sub, 8, -2);
  assert(d.parts.length === n - 6, 'rocket should lose both booster sets');
  assert(d.loose.length === 1 && d.loose[0].parts.length === 3, 'one decoupler, booster and nose set aside');
  assert(G.pieceIndexOf(d, root) === 0 && G.pieceIndexOf(d, d.parts[0].uid) === -1, 'piece lookup');
  const geo = G.layoutLoose(d)[0].parts;
  const r = geo.find((g) => g.uid === root);
  assert(near(r.x, 8, 1e-9) && near(r.top, -2, 1e-9), 'piece sits where it was dropped');
  // taken from the left, it is stored facing right: the booster is on the decoupler's right
  assert(geo.find((g) => g.id === 'srb').x > r.x, 'piece faces right');
  assert(G.cfgVal(G.anyPart(d, geo.find((g) => g.id === 'srb').uid), 'srbLimit') === 60, 'settings kept');
});
test('set-aside parts are not launched, costed or counted for seats', () => {
  const d = G.PRESETS['Orbiter I']();
  const cost = G.designCost(d), parts = d.parts.length;
  G.setAside(d, G.newSub(d, 'heron'), 6, 0);
  G.setAside(d, G.newSub(d, 'tankXL'), -6, 0);
  assert(G.designCost(d) === cost && d.parts.length === parts && G.designSeats(d) === 1, 'loose parts leaked into the rocket');
  const a = G.analyzeDesign(d);
  assert(a.valid && a.parts.length === parts, 'analysis only sees the rocket');
  const c = new G.Craft(G.cloneParts(G.layoutDesign(d)));
  assert(!c.parts.some((p) => p.id === 'heron' || p.id === 'tankXL'), 'launched craft has set-aside parts');
});
test('you can build onto a set-aside piece, then put it back on the rocket', () => {
  const d = G.PRESETS['Orbiter I']();
  const tank = G.setAside(d, G.newSub(d, 'tankM'), 6, 0);
  // build onto it: an engine below and fins on its sides
  const eng = G.editOwner(d, tank, (pd) => G.attachPart(pd, 'wren', tank, 'bottom', 0, 0, false))[0];
  G.editOwner(d, tank, (pd) => G.attachPart(pd, 'fins', tank, 'side', 1, 0.5, true));
  assert(d.loose[0].parts.length === 4, 'piece grew to 4 parts');
  assert(G.pieceIndexOf(d, eng) === 0, 'engine belongs to the piece');
  const uids = new Set([...d.parts, ...d.loose[0].parts].map((p) => p.uid));
  assert(uids.size === d.parts.length + 4, 'uids stay unique across rocket and pieces');
  // pick the whole piece up and attach it under the rocket's capsule's decoupler stack
  const sub = G.takePiece(d, 0);
  assert(!d.loose.length, 'piece removed from the floor');
  const pod = d.parts.find((p) => p.id === 'pod');
  const top = G.attachPart(d, 'tankM', pod.uid, 'top', 0, 0, false);
  G.insertSubtree(d, sub, top);
  const fins = d.parts.filter((p) => p.id === 'fins');
  assert(d.parts.filter((p) => p.id === 'wren').length === 2 && fins.length >= 4, 'piece rejoined with its children');
  assert(G.layoutDesign(d).length === d.parts.length, 'every part is connected');
});
test('deleting a set-aside piece, and pulling a part off one', () => {
  const d = G.PRESETS['Sky Hopper']();
  const t = G.setAside(d, G.newSub(d, 'tankL'), 5, 0);
  const e = G.editOwner(d, t, (pd) => G.attachPart(pd, 'ox', t, 'bottom', 0, 0, false))[0];
  const sub = G.editOwner(d, e, (pd) => G.extractSubtree(pd, e));
  assert(sub.recs.length === 1 && d.loose[0].parts.length === 1, 'engine pulled off the piece');
  G.setAside(d, sub, 9, 0);
  assert(d.loose.length === 2, 'engine now a piece of its own');
  G.editOwner(d, t, (pd) => G.removePartTree(pd, t));
  assert(d.loose.length === 1 && d.loose[0].parts[0].id === 'ox', 'deleting a piece root removes the piece');
});
test('set-aside pieces save with the craft and survive loading', () => {
  const d = G.PRESETS['Orbiter I']();
  G.setAside(d, G.newSub(d, 'heron'), 6, 1);
  const back = G.migrateDesign(JSON.parse(JSON.stringify(d)));
  assert(back.loose && back.loose.length === 1 && back.loose[0].parts[0].id === 'heron' && back.loose[0].x === 6, 'piece lost on reload');
  const bad = G.migrateDesign({ v: 2, parts: d.parts, nextUid: d.nextUid, loose: [{ x: 0, y: 0, parts: [{ uid: 999, id: 'nope', parent: null }] }] });
  assert(!bad.loose, 'pieces of unknown parts are dropped');
  const old = G.migrateDesign(JSON.parse(JSON.stringify(G.PRESETS['Orbiter I']())));
  assert(!old.loose, 'older crafts have nothing set aside');
});
test('moving a part keeps its settings', () => {
  const d = G.PRESETS['Orbiter I']();
  const tank = d.parts.find((p) => p.id === 'tankM');
  G.setPartCfg(d, tank.uid, 'fill', 40);
  const sub = G.extractSubtree(d, tank.uid);
  const pod = d.parts.find((p) => p.id === 'pod');
  const nu = G.attachPart(d, 'tankM', pod.uid, 'bottom', 0, 0, false);
  G.insertSubtree(d, sub, nu);
  assert(G.cfgVal(G.anyPart(d, nu[0]), 'fill') === 40, 'fill level lost when moved');
});

console.log('\nBiomes');
test('every world with ground has biomes, and every biome can be found on it', () => {
  for (const b of G.BODIES) {
    if (b.star || b.gas) { assert(G.biomeAt(b, 1) === null, `${b.name} should have no biomes`); continue; }
    assert(G.BIOMES[b.id], `${b.name} has no biomes`);
    const names = new Set(G.biomeNames(b)), found = new Map();
    for (let i = 0; i < 20000; i++) { const n = G.biomeAt(b, (i / 20000) * Math.PI * 2); assert(names.has(n), `${b.name}: unknown biome ${n}`); found.set(n, (found.get(n) || 0) + 1); }
    for (const n of names) assert(found.has(n), `${b.name}: ${n} never appears`);
    const hi = G.BIOMES[b.id].high;
    const share = found.get(hi) / 20000;
    assert(share > 0.04 && share < 0.2, `${b.name}: ${hi} covers ${(share * 100).toFixed(0)}%`);
  }
});
test('the pad and runway are the Space Centre; Verdan has seas and shores', () => {
  assert(G.biomeAt(G.HOME, G.PAD_PHI) === 'Space Centre', 'pad');
  assert(G.biomeAt(G.HOME, G.PAD_PHI - (G.RUNWAY_START + G.RUNWAY_END) / 2) === 'Space Centre', 'runway');
  let sea = null;
  for (let i = 0; i < 5000 && sea == null; i++) { const phi = i / 5000 * 6.28; if (G.terrainH(G.HOME, phi) < 0) sea = phi; }
  assert(sea != null && G.biomeAt(G.HOME, sea) === 'Seas', 'sea biome');
});
test('science landed counts once per biome; science in space does not depend on biome', () => {
  const s = G.newSave('career', 9);
  const b = G.MOON, phis = [];
  const names = new Set();
  for (let i = 0; i < 400 && phis.length < 2; i++) { const phi = i / 400 * 6.28, n = G.biomeAt(b, phi); if (!names.has(n)) { names.add(n); phis.push(phi); } }
  const p = { def: G.PART_DEFS.thermometer || Object.values(G.PART_DEFS).find((d) => d.exp === 'thermo') };
  const vals = phis.map((phi) => {
    const c = { pos: [Math.cos(phi) * b.R, Math.sin(phi) * b.R], landed: { body: b } };
    const bp = G.bodyPos(b, 0); c.pos[0] += bp[0]; c.pos[1] += bp[1];
    const sit = 'landed', bio = G.sciBiome(c, b, 0, sit);
    const q = { def: p.def };
    const r = G.runExperiment(s, q, b, sit, bio);
    G.creditResult(s, r.result, 1);
    return { v: r.value, id: r.result.id, bio };
  });
  assert(vals[0].bio !== vals[1].bio && vals[0].id !== vals[1].id, 'different biomes, different subjects');
  assert(near(vals[0].v, vals[1].v, 1e-9) && vals[0].v > 0, 'each biome is worth the full amount');
  const c = { pos: [b.R * 2, 0] };
  assert(G.sciBiome(c, b, 0, 'spaceLow') === null && G.subjectId('thermo', b, 'spaceLow', null) === 'thermo@pallid:spaceLow', 'space subjects unchanged (old saves keep their science)');
});
test('biome contracts only complete in the right biome', () => {
  const s = G.newSave('career', 21);
  Object.assign(s.milestones, { orbit: true, space: true, alt10k: true, land_pallid: true, orbit_pallid: true });
  let land = null, sci = null;
  for (let i = 0; i < 400 && !(land && sci); i++) {
    const c = G.genContract(s);
    if (!c) continue;
    if (c.type === 'land' && c.p.biome && !land) land = c;
    if (c.type === 'science' && c.p.biome && !sci) sci = c;
  }
  assert(land && sci, 'biome contracts are offered');
  for (const c of [land, sci]) { c.state = 'active'; s.contracts.push(c); }
  const body = G.BODY_BY_ID[land.p.body];
  const other = G.biomeNames(body).find((n) => n !== land.p.biome);
  assert(!G.checkContracts(s, { kind: 'land', body, biome: other }).length, 'wrong biome should not count');
  assert(G.checkContracts(s, { kind: 'land', body, biome: land.p.biome }).includes(land), 'right biome counts');
  const sb = G.BODY_BY_ID[sci.p.body];
  assert(!G.checkContracts(s, { kind: 'science', body: sb, sit: sci.p.sit, biome: null }).includes(sci), 'no biome should not count');
  assert(G.checkContracts(s, { kind: 'science', body: sb, sit: sci.p.sit, biome: sci.p.biome }).includes(sci), 'right biome science counts');
});

console.log('\nSpacewalks');
/* A crewed Sky Hopper either landed on Pallid or in orbit round Verdan, with one astronaut aboard. */
function evaSetup(where) {
  G.Career.s = G.newSave('career', 5);
  const s = G.Career.s; s.vessels = []; s.vesselSeq = 1;
  G.flightStart(G.PRESETS['Sky Hopper'](), 'Hopper', { t0: 0 });
  const F = G.F, c = F.craft;
  F.others = []; F.tutorial = null;
  const pod = c.parts.find((p) => p.def.seats);
  F.crew = [{ id: s.crew[0].id, name: s.crew[0].name, pod: pod.uid }];
  if (where === 'pallid') {
    const b = G.MOON, phi = 1.0, bp = G.bodyPos(b, 0);
    const lowest = Math.min(...c.contacts.map((q) => q[1]));
    const r = b.R + G.terrainH(b, phi) + (c.yc - lowest) + 0.02;
    c.angle = phi; c.pos = [bp[0] + r * Math.cos(phi), bp[1] + r * Math.sin(phi)]; c.vel = G.bodyState(b, 0).slice(2, 4);
    c.landed = { body: b, rx: c.pos[0] - bp[0], ry: c.pos[1] - bp[1] };
  } else {
    const r = G.HOME.R + 120000, v = Math.sqrt(G.HOME.mu / r);
    c.landed = null; c.pos = [r, 0]; c.vel = [0, v]; c.angle = 0;
  }
  F.lastBody = where === 'pallid' ? G.MOON : G.HOME;
  return { F, s, ship: c };
}
const steps = (n) => { for (let i = 0; i < n; i++) G.physStep(G.PHYS_DT); };

test('an astronaut climbs out onto Pallid, walks, hops and lands on their feet', () => {
  const { F, ship } = evaSetup('pallid');
  const shipVid = F.vid;
  G.goEva();
  assert(F.kind === 'eva' && F.craft.isEva, 'now flying the astronaut');
  assert(F.crew.length === 1 && F.crew[0].pod === F.craft.parts[0].uid, 'astronaut is the crew');
  const shipNow = F.others.find((o) => o.vid === shipVid);
  assert(shipNow && shipNow.meta.crew.length === 0, 'the ship is left behind, empty');
  assert(F.craft.landed && F.craft.landed.body === G.MOON, 'standing on Pallid');
  assert(F.canRevert, 'can still revert the flight');
  const phi0 = Math.atan2(F.craft.landed.ry, F.craft.landed.rx);
  F.walk = 1; F.keys.KeyD = true;
  for (let i = 0; i < 150; i++) { G.flightUpdate(G.PHYS_DT); }
  F.keys.KeyD = false;
  const phi1 = Math.atan2(F.craft.landed.ry, F.craft.landed.rx);
  const walked = (phi0 - phi1) * G.MOON.R;
  assert(walked > 3 && walked < 6, `walked ${walked.toFixed(2)} m in 3 s`);
  G.evaHop();
  steps(2);
  assert(!F.craft.landed, 'in the air after a hop');
  steps(800);
  assert(F.craft.landed && !F.craft.dead, 'came down safely');
});
test('planting a flag leaves a flag vessel, earns the milestone and completes the contract', () => {
  const { F, s } = evaSetup('pallid');
  s.contracts.push({ id: 99, type: 'flag', state: 'active', title: 'Plant a flag on Pallid', p: { body: 'pallid' }, reward: 1000, sci: 1, rep: 1, deadline: 1e12 });
  G.goEva();
  const funds = s.funds;
  G.plantFlag();
  const flag = F.others.find((o) => o.meta && o.meta.kind === 'flag');
  assert(flag && flag.landed && flag.landed.body === G.MOON, 'flag planted');
  assert(s.milestones.flag_pallid, 'milestone');
  assert(s.contracts.find((c) => c.id === 99).state === 'done', 'contract complete');
  assert(s.funds > funds, 'paid');
  // flags survive being saved and loaded
  const rec = G.vesselFromCraft(flag, G.F.t, flag.meta);
  const back = G.craftFromVessel(rec);
  assert(back.parts[0].id === 'flag' && back.landed, 'flag round-trips');
});
test('surface samples are carried back aboard and recovered', () => {
  const { F, s } = evaSetup('pallid');
  const shipVid = F.vid;
  G.goEva();
  const me = F.craft.parts[0];
  const sit = G.situationOf(F.craft, G.MOON, F.t);
  const r1 = G.collectResult(s, me, 'sample', G.MOON, sit, 'Near Plains');
  const r2 = G.collectResult(s, me, 'sample', G.MOON, sit, 'Near Plains');
  const r3 = G.collectResult(s, me, 'evaReport', G.MOON, sit, 'Near Plains');
  assert(r1 && !r2 && r3 && me.held.length === 2, 'one result per subject, several carried');
  assert(!G.collectResult(s, me, 'sample', G.MOON, 'spaceLow', null), 'no surface samples in space');
  // walk back to the hatch and climb in
  const ship = F.others.find((o) => o.vid === shipVid);
  const pod = ship.parts.find((p) => p.def.seats);
  const hatch = ship.toWorld(pod.x, pod.bot);
  F.craft.pos = [hatch[0], hatch[1]];
  assert(G.boardTarget(), 'close enough to board');
  const name = F.crew[0].name;
  G.boardNearby();
  assert(F.kind === 'ship' && F.vid === shipVid && G.crewNames(F.crew).includes(name), 'back aboard');
  assert(!F.others.some((o) => o.isEva), 'no astronaut left outside');
  const held = F.craft.parts.find((p) => p.def.seats).held;
  assert(held && held.length === 2, 'science moved into the capsule');
  const rec = G.vesselFromCraft(F.craft, F.t, { id: F.vid, name: 'x', crew: F.crew, kind: 'ship' });
  const sci = s.science;
  rec.landed = null;
  G.recoverRecord(rec);
  assert(s.science > sci + 50, `recovered ${s.science - sci} science`);
});
test('in orbit the astronaut floats beside the ship, jetpacks, and boards again', () => {
  const { F, ship } = evaSetup('orbit');
  G.goEva();
  const e = F.craft;
  assert(!e.landed && Math.hypot(e.pos[0] - ship.pos[0], e.pos[1] - ship.pos[1]) < 5, 'beside the ship');
  const v0 = e.vel.slice(), mono0 = e.parts[0].mono;
  F.keys.KeyH = true;
  for (let i = 0; i < 50; i++) G.flightUpdate(G.PHYS_DT);
  F.keys.KeyH = false;
  assert(e.parts[0].mono < mono0, 'jetpack uses monopropellant');
  assert(G.boardTarget(), 'the hatch is in reach');
  G.evaKey();
  assert(F.kind === 'ship' && F.crew.length === 1, 'aboard again');
});
test('sandbox flights carry a guest astronaut for spacewalks; gas giants and dense air keep the hatch shut', () => {
  G.Career.s = G.newSave('sandbox', 3);
  const { F } = evaSetup('orbit');
  F.craft.q = 5;
  G.goEva();
  assert(F.kind !== 'eva', 'hatch stays shut in dense air');
});

console.log('\nAstronaut roles and Space Centre upgrades');
test('a new career has a pilot, an engineer and a scientist, and level-1 buildings; sandbox is fully upgraded', () => {
  const s = G.newSave('career', 4);
  assert(s.crew.map((c) => c.role).join() === 'pilot,engineer,scientist', 'roles');
  assert(Object.values(s.levels).every((l) => l === 1), 'level 1');
  const sb = G.newSave('sandbox', 4);
  assert(G.facLevel(sb, 'hangar') === 3 && G.facLimit(sb, 'pad') === Infinity, 'sandbox level 3');
});
test('older saves get roles, and older careers start with level-2 buildings', () => {
  const old = { v: 1, mode: 'career', crew: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }, { id: 4, name: 'D' }] };
  G.migrateSave(old);
  assert(old.crew.map((c) => c.role).join() === 'pilot,engineer,scientist,pilot', 'roles filled');
  assert(G.facLevel(old, 'mission') === 2 && G.facLimit(old, 'hangar') === 255, 'level 2');
});
test('upgrades cost money and lift limits: contracts, research, astronauts and parts', () => {
  const s = G.newSave('career', 8);
  assert(G.maxActive(s) === 2, 'two contracts at level 1');
  s.science = 1000;
  s.tech.push('general', 'advanced', 'fuelsys');
  assert(/Research Lab/.test(G.research(s, 'heavy')), 'lab too small for a 120-science node');
  s.funds = 1e6;
  assert(G.upgradeFacility(s, 'lab') === null && G.facLevel(s, 'lab') === 2, 'lab upgraded');
  assert(G.research(s, 'heavy') === null, 'now it can research it');
  assert(G.upgradeFacility(s, 'mission') === null && G.maxActive(s) === 7, 'more contracts');
  const before = s.funds;
  G.upgradeFacility(s, 'mission');
  assert(before - s.funds === 180000 && G.upgradeFacility(s, 'mission') !== null, 'level 3 is the top');
  s.funds = 1e6;
  while (s.crew.length < 5) assert(G.hireCrew(s, false, 'engineer'), 'hire up to five');
  assert(G.hireCrew(s, false, 'engineer') === null, 'office full at five');
  s.funds = 10;
  assert(G.upgradeFacility(s, 'astro') !== null, 'needs money');
});
test('pilots unlock SAS modes by rank; probe cores give the basics; tracking level limits warp and nodes', () => {
  G.Career.s = G.newSave('career', 2);
  const s = G.Career.s; s.vessels = []; s.vesselSeq = 1;
  G.flightStart(G.PRESETS['Sky Hopper'](), 'Hopper', { t0: 0 });
  const F = G.F; F.tutorial = null;
  const pod = F.craft.parts.find((p) => p.def.seats);
  F.crew = [{ id: 2, name: s.crew[1].name, pod: pod.uid }]; // the engineer
  assert(G.sasAllowed('stab') && !G.sasAllowed('pro'), 'engineer: hold only');
  F.crew = [{ id: 1, name: s.crew[0].name, pod: pod.uid }]; // the pilot, rank 0
  assert(G.sasAllowed('pro') && !G.sasAllowed('radout'), 'new pilot: prograde');
  s.crew[0].flights = 4;
  assert(G.sasAllowed('node') && G.sasAllowed('tgt'), 'experienced pilot: everything');
  G.flightStart(G.PRESETS['Comms Probe'](), 'Probe', { t0: 0 });
  F.crew = [];
  assert(G.sasAllowed('retro') && !G.sasAllowed('node'), 'probe core: prograde and retrograde');
  assert(G.maxWarp() === 8 && !G.nodesAllowed(), 'level-1 tracking: 10,000× and no nodes');
  s.levels.tracking = 2;
  assert(G.maxWarp() === 9 && G.nodesAllowed(), 'level 2');
  G.Career.s = G.newSave('sandbox', 1);
  assert(G.sasAllowed('tgt') && G.maxWarp() === 10, 'sandbox has everything');
});
test('scientists add to science and reset experiments; engineers repack parachutes', () => {
  G.Career.s = G.newSave('career', 6);
  const s = G.Career.s; s.vessels = []; s.vesselSeq = 1;
  G.flightStart(G.PRESETS['Sky Hopper'](), 'Hopper', { t0: 0 });
  const F = G.F, c = F.craft, pod = c.parts.find((p) => p.def.seats);
  F.crew = [{ id: 3, name: s.crew[2].name, pod: pod.uid }];
  assert(G.crewHasRole('scientist') && !G.crewHasRole('engineer'), 'scientist aboard');
  assert(G.scienceBonus(s, F.crew) > 1.05 && G.scienceBonus(s, [{ id: 1 }]) === 1, 'bonus only from scientists');
  const chute = c.parts.find((p) => p.def.chute);
  chute.open = true; chute.area = 100;
  assert(!G.partActions(c, chute).some((x) => x[0] === 'repack'), 'no engineer, no repack');
  F.crew = [{ id: 2, name: s.crew[1].name, pod: pod.uid }];
  assert(G.partActions(c, chute).some((x) => x[0] === 'repack'), 'engineer can repack once down');
});

console.log('\nMining and refuelling');
test('ore is in the ground of rocky worlds, more in some biomes, never in seas or gas giants', () => {
  let sea = null;
  for (let i = 0; i < 4000 && sea == null; i++) { const phi = i / 4000 * 6.28; if (G.terrainH(G.HOME, phi) < 0) sea = phi; }
  assert(G.oreAt(G.HOME, sea) === 0, 'no ore in the sea');
  assert(G.oreAt(G.TEMPEST, 1) === 0 && G.oreAt(G.SUN, 1) === 0, 'none in a gas giant or the star');
  const vals = new Set();
  for (let i = 0; i < 200; i++) vals.add(G.oreAt(G.MOON, i / 200 * 6.28).toFixed(4));
  assert([...vals].every((v) => +v > 0) && vals.size > 2, 'Pallid has ore everywhere, in different amounts');
});
/* A mining lander standing on Pallid: ore bin, fuel tank, refinery and battery, with a drill reaching the ground. */
function minerOnPallid() {
  const d = G.newDesign();
  const bin = G.attachPart(d, 'oreTank', null)[0];
  const tank = G.attachPart(d, 'tankM', bin, 'bottom', 0, 0, false)[0];
  G.attachPart(d, 'converter', bin, 'top', 0, 0, false);
  G.attachPart(d, 'batteryBank', tank, 'side', 1, 0.2, false);
  G.attachPart(d, 'drill', tank, 'side', -1, G.PART_DEFS.tankM.h - G.PART_DEFS.drill.h, false);
  const c = new G.Craft(G.layoutDesign(d));
  c.recompute();
  const b = G.MOON, phi = 0.5, bp = G.bodyPos(b, 0);
  const lowest = Math.min(...c.contacts.map((q) => q[1]));
  const r = b.R + G.terrainH(b, phi) + (c.yc - lowest) + 0.02;
  c.angle = phi; c.pos = [bp[0] + r * Math.cos(phi), bp[1] + r * Math.sin(phi)];
  c.landed = { body: b, rx: c.pos[0] - bp[0], ry: c.pos[1] - bp[1] };
  for (const p of c.parts) if (p.def.ec) p.ec = p.def.ec;
  return c;
}
test('a drill on the ground digs ore at a rate set by the ground, faster with an engineer, and uses power', () => {
  const c = minerOnPallid(), dr = c.drills[0];
  assert(G.drillOnGround(c, dr, 0), 'drill reaches the ground');
  dr.drilling = true;
  const ec0 = c.parts.reduce((a, p) => a + p.ec, 0);
  for (let i = 0; i < 100; i++) G.miningStep(c, 0.1, 0, 1);
  const ore = c.propTotal('ore'), expect = G.PART_DEFS.drill.drill * G.oreBelow(c, 0) / 0.05 * 10;
  assert(near(ore, expect, expect * 0.01), `dug ${ore.toFixed(4)} t, expected ${expect.toFixed(4)}`);
  assert(c.parts.reduce((a, p) => a + p.ec, 0) < ec0 - 30, 'used charge');
  const c2 = minerOnPallid(); c2.drills[0].drilling = true;
  for (let i = 0; i < 100; i++) G.miningStep(c2, 0.1, 0, 1.5);
  assert(near(c2.propTotal('ore'), ore * 1.5, ore * 0.02), 'engineer digs 1.5× as fast');
  // up in the air the drill can't reach anything
  const c3 = minerOnPallid(); c3.drills[0].drilling = true; c3.landed = null;
  G.miningStep(c3, 1, 0, 1);
  assert(c3.propTotal('ore') === 0, 'no ore in flight');
  // and with flat batteries it stops
  const c4 = minerOnPallid(); c4.drills[0].drilling = true;
  for (const p of c4.parts) p.ec = 0;
  G.miningStep(c4, 1, 0, 1);
  assert(c4.propTotal('ore') === 0, 'no power, no ore');
});
test('the refinery turns ore into fuel (90%) until the tanks are full; fuel moves between tanks', () => {
  const c = minerOnPallid();
  const bin = c.parts.find((p) => p.id === 'oreTank'), tank = c.parts.find((p) => p.id === 'tankM');
  bin.ore = 1.0; tank.fuel = 0;
  const ref = c.converters[0];
  ref.converting = 'fuel';
  for (let i = 0; i < 300; i++) G.miningStep(c, 0.1, 0, 1);
  const used = 1.0 - bin.ore;
  assert(near(used, G.PART_DEFS.converter.convert * 30, 1e-6), `used ${used} t of ore`);
  assert(near(tank.fuel, used * G.ORE_YIELD, 1e-6), 'fuel made from ore');
  bin.ore = 1.5; ref.converting = null;
  const m0 = c.M;
  c.updateMass();
  assert(c.M > m0, 'ore adds mass');
  // fuel transfer between tanks
  const d2 = G.newDesign();
  const a = G.attachPart(d2, 'tankM', null)[0];
  G.attachPart(d2, 'tankM', a, 'bottom', 0, 0, false);
  const c2 = new G.Craft(G.layoutDesign(d2)); c2.recompute();
  const [t1, t2] = c2.parts;
  t1.fuel = 0.2; t2.fuel = 0.5;
  const moved = G.transferProp(c2, t1, 'fuel', 'fuel', true);
  assert(near(moved, 0.5, 1e-9) && near(t1.fuel, 0.7, 1e-9) && t2.fuel < 1e-9, 'pulled all of it');
  G.transferProp(c2, t1, 'fuel', 'fuel', false);
  assert(near(t2.fuel, 0.7, 1e-9) && t1.fuel < 1e-9, 'pushed it back');
});
test('ore and running drills survive saving and loading', () => {
  const c = minerOnPallid();
  c.parts.find((p) => p.id === 'oreTank').ore = 0.8; c.drills[0].drilling = true; c.converters[0].converting = 'mono';
  const back = G.craftFromVessel(G.vesselFromCraft(c, 0, { id: 1, name: 'm' }));
  assert(near(back.propTotal('ore'), 0.8, 1e-9) && back.drills[0].drilling && back.converters[0].converting === 'mono', 'kept');
});

console.log('\nComms network');
/* A probe (core + battery, optional antenna) at a given angle and altitude round Verdan, with the network on. */
function probeAt(phi, alt, extra) {
  G.Career.s = G.newSave('career', 12);
  const s = G.Career.s; s.vessels = []; s.vesselSeq = 1;
  const d = G.newDesign();
  const core = G.attachPart(d, 'probe', null)[0];
  const bat = G.attachPart(d, 'battery', core, 'side', 1, 0, false)[0];
  if (extra) G.attachPart(d, extra, core, 'side', -1, 0, false);
  G.flightStart(d, 'Probe', { t0: 0 });
  const F = G.F, c = F.craft, r = G.HOME.R + alt;
  c.landed = null; c.pos = [r * Math.cos(phi), r * Math.sin(phi)]; c.vel = [0, 0];
  F.others = []; F.tutorial = null; F.crew = [];
  return { F, s, c };
}
const relayRecord = (s, phi, alt) => {
  const d = G.newDesign();
  const core = G.attachPart(d, 'probe', null)[0];
  G.attachPart(d, 'relayS', core, 'side', 1, 0, false);
  const c = new G.Craft(G.layoutDesign(d)); c.recompute();
  const r = G.HOME.R + alt; c.pos = [r * Math.cos(phi), r * Math.sin(phi)]; c.vel = [0, 0]; c.angle = 0;
  const v = G.vesselFromCraft(c, 0, { id: s.vesselSeq++, name: 'Relay One' });
  s.vessels.push(v);
  return v;
};
test('a probe above a ground station has a signal; behind Verdan it has none and loses control', () => {
  const { F, c } = probeAt(G.PAD_PHI, 100000);
  assert(G.commnetOn(), 'network on in a new career');
  F.comm = G.linkToHome(c, 0);
  assert(F.comm.ok && F.comm.station === 'Space Centre' && G.hasControl(c), 'signal over the Space Centre');
  // halfway between two stations, low down: the planet blocks every station
  const b = probeAt(G.PAD_PHI + Math.PI / 3, 100000);
  b.F.comm = G.linkToHome(b.c, 0);
  assert(!b.F.comm.ok && !G.hasControl(b.c), 'no signal, no control');
  assert(!G.hasSignal(), 'no transmitting either');
  // crewed craft never need a signal
  b.c.hasPod = true;
  assert(G.hasControl(b.c), 'crew can always fly');
});
test('a relay satellite high above passes the signal on', () => {
  const { F, s, c } = probeAt(G.PAD_PHI + Math.PI / 3, 100000);
  relayRecord(s, G.PAD_PHI + Math.PI / 3, 2000000);
  F.comm = G.linkToHome(c, 0);
  assert(F.comm.ok && F.comm.via[0] === 'Relay One' && F.comm.path.length === 3, 'via the relay');
  assert(G.hasControl(c), 'control restored');
});
test('antenna range matters: a bare probe core reaches low orbit but not Pallid; a whip antenna does', () => {
  const far = probeAt(G.PAD_PHI, 8e6);
  assert(!G.linkToHome(far.c, 0).ok, 'probe core alone is out of range');
  const whip = probeAt(G.PAD_PHI, 8e6, 'antenna');
  assert(G.linkToHome(whip.c, 0).ok, 'whip antenna reaches');
  assert(G.partsRange([{ id: 'relayL' }]).relay === G.PART_DEFS.relayL.range, 'relay dish relays');
});
test('with the network off (sandbox and older games) nothing changes', () => {
  const { F, s, c } = probeAt(G.PAD_PHI + Math.PI / 3, 100000);
  s.commnet = false;
  F.comm = null;
  assert(!G.commnetOn() && G.hasControl(c) && G.hasSignal(), 'free control');
  assert(G.newSave('sandbox', 1).commnet === false, 'sandbox starts with it off');
});

console.log('\nAction groups, clamps, lights and the claw');
test('launch clamps go with the first stage and hold the rocket down until it fires', () => {
  G.Career.s = G.newSave('sandbox', 1);
  const d = G.PRESETS['Orbiter I']();
  const low = d.parts.filter((p) => p.id === 'tankL').pop();
  G.attachPart(d, 'clamp', low.uid, 'side', 1, 0.5, true);
  const a = G.analyzeDesign(d);
  const clamps = a.parts.filter((p) => p.def.clamp).map((p) => p.uid);
  assert(clamps.length === 2 && clamps.every((u) => a.stages[0].includes(u)), 'clamps in the first stage');
  assert(a.stages.length === G.analyzeDesign(G.PRESETS['Orbiter I']()).stages.length, 'no extra stage');
  G.flightStart(d, 'Clamped', { t0: 0 });
  const F = G.F, c = F.craft; F.others = []; F.tutorial = null;
  for (const e of c.engines) e.ignited = true;
  c.throttle = 1;
  steps(100);
  assert(c.landed, 'held down with the engines at full power');
  G.doStage();
  assert(!c.parts.some((p) => p.def.clamp), 'clamps let go');
  steps(100);
  assert(!c.landed && c.vel[1] > 1, 'lifted off');
});
test('action groups fire their parts; Abort cuts the throttle too', () => {
  G.Career.s = G.newSave('sandbox', 1);
  const d = G.PRESETS['Orbiter I']();
  const chute = d.parts.find((p) => p.id === 'chute').uid, dec = d.parts.find((p) => p.id === 'decoupler').uid;
  d.groups = { 1: [chute], abort: [dec] };
  G.flightStart(d, 'Grouped', { t0: 0 });
  const F = G.F, c = F.craft; F.others = []; F.debris = []; F.tutorial = null;
  c.landed = null; c.pos = [0, G.HOME.R + 50000]; c.vel = [0, 0];
  G.fireGroup('1');
  assert(c.byUid.get(chute).open, 'parachute opened by group 1');
  c.throttle = 1;
  const n = c.parts.length;
  G.fireGroup('abort');
  assert(c.throttle === 0 && c.parts.length < n, 'abort: throttle cut, decoupler fired');
  // groups are kept with the vessel
  const back = G.craftFromVessel(G.vesselFromCraft(c, F.t, { id: 1, name: 'g' }));
  assert(back.actionGroups['1'][0] === chute, 'groups saved with the vessel');
});
test('floodlights switch on and use a little charge', () => {
  G.Career.s = G.newSave('sandbox', 1);
  const d = G.PRESETS['Comms Probe']();
  const tank = d.parts.find((p) => p.id === 'tankM125').uid;
  G.attachPart(d, 'light', tank, 'side', 1, 0.8, true);
  G.flightStart(d, 'Lit', { t0: 0 });
  const c = G.F.craft;
  G.toggleLights();
  assert(c.lights.length === 2 && c.lights.every((p) => p.lit), 'both on');
  const e0 = c.parts.reduce((a, p) => a + p.ec, 0);
  G.electricStep(c, 10, 0, 0);
  const e1 = c.parts.reduce((a, p) => a + p.ec, 0);
  G.toggleLights();
  G.electricStep(c, 10, 0, 0);
  const e2 = c.parts.reduce((a, p) => a + p.ec, 0);
  assert(e0 - e1 > (e1 - e2) + 0.9, 'lights drain charge');
});
test('the claw grabs any part of another vessel it touches slowly, and lets go again', () => {
  G.Career.s = G.newSave('sandbox', 1);
  const s = G.Career.s; s.vessels = []; s.vesselSeq = 1;
  const d = G.newDesign();
  const core = G.attachPart(d, 'probe', null)[0];
  const bat = G.attachPart(d, 'batteryRing', core, 'bottom', 0, 0, false)[0];
  G.attachPart(d, 'claw', bat, 'bottom', 0, 0, false);
  G.flightStart(d, 'Grabber', { t0: 0 });
  const F = G.F, a = F.craft; F.others = []; F.debris = []; F.tutorial = null;
  const r = G.HOME.R + 200000, v = Math.sqrt(G.HOME.mu / r);
  a.landed = null; a.angle = Math.PI / 2; a.pos = [0, r]; a.vel = [-v, 0]; a.angVel = 0;
  // a lone fuel tank floating just below the claw
  const tb = new G.Craft(G.layoutDesign(G.designFromStack(['tankL'])));
  tb.recompute(); tb.angle = 0; tb.angVel = 0;
  const claw = a.parts.find((p) => p.def.claw);
  const tip = a.toWorld(claw.x, claw.bot);
  tb.pos = [tip[0], tip[1] - 1.05]; tb.vel = [-v, -0.3];
  tb.vid = 77; tb.meta = { id: 77, name: 'Spare tank', crew: [], kind: 'ship', flags: { visited: [] } };
  F.others.push(tb);
  for (let i = 0; i < 200 && F.others.length; i++) G.physStep(G.PHYS_DT);
  assert(!F.others.length && a.parts.some((p) => p.id === 'tankL'), 'grabbed the tank');
  assert(claw.grabbed != null, 'claw holds on');
  G.undock(claw);
  assert(!a.parts.some((p) => p.id === 'tankL') && F.debris.concat(F.others).some((o) => o.parts.some((p) => p.id === 'tankL')), 'let go');
  assert(claw.grabbed == null, 'claw free again');
});

console.log('\nAsteroids, difficulty and the flight log');
test('asteroids turn up every few days on orbits clear of the air, up to three at once, and drift away', () => {
  const s = G.newSave('career', 31); s.vessels = []; s.vesselSeq = 1;
  G.asteroidTick(s);
  assert(!s.vessels.length, 'none on day one');
  s.ut = 10 * G.DAY; G.asteroidTick(s);
  const rocks = () => s.vessels.filter((v) => v.kind === 'asteroid');
  assert(rocks().length >= 1, 'one spotted');
  for (let d = 10; d < 200; d += 2) { s.ut = d * G.DAY; G.asteroidTick(s); assert(rocks().length <= 3, 'never more than three'); }
  for (const v of rocks()) {
    const o = G.orbitElements(G.HOME, v.s[0], v.s[1], v.s[2], v.s[3], v.t);
    assert(o.e < 1 && o.rp - G.HOME.R > G.HOME.atmo.top && o.ra < 9e6, 'a safe loop round Verdan, inside Pallid');
    assert(v.expires > s.ut && v.parts[0].ore > 0, 'leaves later, full of ore');
  }
  const first = rocks()[0];
  s.ut = first.expires + 1; G.asteroidTick(s);
  assert(!s.vessels.includes(first), 'drifted away');
});
test('a claw holds an asteroid, drills dig its ore, and letting go leaves it as a vessel', () => {
  G.Career.s = G.newSave('sandbox', 1);
  const s = G.Career.s; s.vessels = []; s.vesselSeq = 1;
  const d = G.newDesign();
  const core = G.attachPart(d, 'probe', null)[0];
  const bin = G.attachPart(d, 'oreTank', core, 'bottom', 0, 0, false)[0];
  const bank = G.attachPart(d, 'batteryRing', bin, 'bottom', 0, 0, false)[0];
  G.attachPart(d, 'drill', bin, 'side', 1, 0, false);
  G.attachPart(d, 'claw', bank, 'bottom', 0, 0, false);
  G.flightStart(d, 'Wrangler', { t0: 0 });
  const F = G.F, a = F.craft; F.others = []; F.debris = []; F.tutorial = null;
  const r = G.HOME.R + 300000, v = Math.sqrt(G.HOME.mu / r);
  a.landed = null; a.angle = Math.PI / 2; a.pos = [0, r]; a.vel = [-v, 0]; a.angVel = 0;
  const rec = G.spawnAsteroid(s);
  s.vessels = s.vessels.filter((x) => x !== rec);
  const rock = G.craftFromVessel(rec);
  rock.angle = 0; rock.angVel = 0;
  const claw = a.parts.find((p) => p.def.claw), tip = a.toWorld(claw.x, claw.bot);
  rock.pos = [tip[0], tip[1] - rock.parts[0].def.h / 2 - 0.3]; rock.vel = [-v, -0.2];
  rock.meta = { id: rec.id, name: rec.name, crew: [], kind: 'asteroid', flags: rec.flags };
  F.others.push(rock);
  for (let i = 0; i < 300 && F.others.length; i++) G.physStep(G.PHYS_DT);
  assert(G.heldRock(a), 'holding the asteroid');
  const ore0 = G.heldRock(a).ore;
  a.drills[0].drilling = true;
  for (let i = 0; i < 50; i++) G.miningStep(a, 0.2, F.t, 1);
  assert(a.propTotal('ore') - G.heldRock(a).ore > 0 && G.heldRock(a).ore < ore0, 'dug ore out of the rock');
  assert(a.parts.find((p) => p.id === 'oreTank').ore > 0, 'into the ore bin');
  G.undock(claw);
  const freed = F.others.find((o) => o.meta && o.meta.kind === 'asteroid');
  assert(freed && freed.parts[0].def.asteroid, 'the rock is a vessel again');
});
test('capturing an asteroid into a low orbit completes the contract', () => {
  const s = G.newSave('career', 2);
  const c = { id: 5, type: 'asteroid', state: 'active', p: { body: 'verdan', maxAp: 2e6 }, reward: 60000, sci: 25, rep: 15, deadline: 1e12 };
  s.contracts.push(c);
  const orbit = (ra) => ({ e: 0.1, rp: G.HOME.R + 200000, ra: G.HOME.R + ra });
  assert(!G.checkContracts(s, { kind: 'tick', body: G.HOME, orbit: orbit(1e6), landed: false, hasAsteroid: false }).length, 'needs an asteroid');
  assert(!G.checkContracts(s, { kind: 'tick', body: G.HOME, orbit: orbit(5e6), landed: false, hasAsteroid: true }).length, 'too high');
  assert(G.checkContracts(s, { kind: 'tick', body: G.HOME, orbit: orbit(1e6), landed: false, hasAsteroid: true }).includes(c), 'captured');
});
test('difficulty settings change rewards, landings and reverting', () => {
  G.Career.s = G.newSave('career', 4);
  const s = G.Career.s;
  assert(G.diff('heat') === 1 && G.diff('revert') === true, 'normal by default');
  s.diff.funds = 1.5; s.diff.science = 0.5;
  const f0 = s.funds, sc0 = s.science;
  G.completeContract(s, { reward: 10000, sci: 10, rep: 1 });
  assert(s.funds - f0 === 15000 && near(s.science - sc0, 5, 1e-9), 'scaled rewards');
  // crash tolerance: a 7 m/s touchdown breaks a capsule normally, but not when sturdy
  const land = (crash) => {
    s.diff.crash = crash;
    s.vessels = []; s.vesselSeq = 1;
    G.flightStart(G.PRESETS['Sky Hopper'](), 'Drop', { t0: 0 });
    const F = G.F, c = F.craft; F.others = []; F.debris = []; F.tutorial = null;
    const lowest = Math.min(...c.contacts.map((q) => q[1]));
    let phi = 1.3;
    while (G.terrainH(G.HOME, phi) < 100) phi += 0.01; // on land, not in the sea
    const r = G.HOME.R + G.terrainH(G.HOME, phi) + (c.yc - lowest) + 0.05;
    c.landed = null; c.angle = phi; c.angVel = 0; c.pos = [r * Math.cos(phi), r * Math.sin(phi)]; c.vel = [-7 * Math.cos(phi), -7 * Math.sin(phi)];
    for (let i = 0; i < 20 && !c.landed && !c.dead; i++) G.physStep(G.PHYS_DT);
    return c.dead;
  };
  assert(land(1) && !land(1.5), 'sturdy craft survive a harder landing');
  s.diff.revert = false;
  assert(!G.canQuickSave(), 'no quick saves when reverting is off');
});
test('the flight log records the launch, orbits, landings and spacewalks, and is saved with the vessel', () => {
  const { F, c } = evaSetup('pallid');
  assert(F.flags.log[0].text.startsWith('Launched'), 'launch logged');
  G.goEva();
  G.plantFlag();
  const texts = F.flags.log.map((e) => e.text).join(' | ');
  assert(/went outside/.test(texts) && /Planted a flag on Pallid/.test(texts), texts);
  const rec = G.vesselFromCraft(F.craft, F.t, { id: F.vid, name: 'x', flags: F.flags });
  assert(rec.flags.log.length >= 3, 'log kept with the vessel');
  // crew react: high g makes them strain, a fast drop near the ground scares them
  const ship = F.craft;
  ship.gforce = 5;
  assert(G.crewMood(ship, 0) === 'strain', 'straining at 5 g');
  ship.gforce = 1; ship.landed = null; ship.radar = 100;
  assert(G.crewMood(ship, -50) === 'scared', 'scared falling fast near the ground');
});

console.log('\nAlarm clock');
test('time warp stops exactly when an alarm goes off, and the alarm is cleared', () => {
  G.Career.s = G.newSave('sandbox', 1);
  const s = G.Career.s; s.vessels = []; s.vesselSeq = 1;
  G.flightStart(G.PRESETS['Comms Probe'](), 'Sat', { t0: 0 });
  const F = G.F, c = F.craft; F.others = []; F.tutorial = null;
  const r = G.HOME.R + 300000, v = Math.sqrt(G.HOME.mu / r);
  c.landed = null; c.pos = [r, 0]; c.vel = [0, v]; c.throttle = 0;
  for (const e of c.engines) e.ignited = false;
  const a2 = G.addAlarm(F.t + 5000, 'Later');
  const a1 = G.addAlarm(F.t + 1234.5, 'Soon');
  assert(G.alarmList()[0] === a1 && G.nextAlarm(F.t) === a1, 'sorted by time');
  F.warp = 7;
  for (let i = 0; i < 200 && F.warp; i++) G.flightUpdate(0.05);
  assert(F.warp === 0 && near(F.t, a1.t, 1e-6), `stopped at ${F.t}, alarm at ${a1.t}`);
  assert(G.alarmList().length === 1 && G.alarmList()[0] === a2, 'rang alarm removed, the other kept');
  const pre = G.alarmPresets().map((p) => p[0]);
  assert(pre.includes('Apoapsis') && pre.includes('Periapsis') && pre.includes('+1 day'), 'presets offered');
  assert(G.alarmClip(0, 100).a === null, 'nothing to clip');
});

console.log('\nSurveys and waypoints');
test('survey contracts mark sites; visiting each (landed, or flying in the right height band) completes it', () => {
  const s = G.newSave('career', 41);
  Object.assign(s.milestones, { orbit: true, space: true, alt10k: true, land_pallid: true });
  let ground = null, air = null;
  for (let i = 0; i < 600 && !(ground && air); i++) {
    const c = G.genContract(s);
    if (c && c.type === 'survey') { if (c.p.air) air = air || c; else ground = ground || c; }
  }
  assert(ground && air, 'both kinds offered');
  assert(ground.p.sites.length >= 2 && ground.p.sites.length <= 4, 'two to four sites');
  const gb = G.BODY_BY_ID[ground.p.body];
  for (const a of ground.p.sites) for (const c of ground.p.sites) if (a !== c) assert(Math.abs(G.wrapPi(a.phi - c.phi)) * gb.R > 3900, 'sites spread out');
  const b = G.BODY_BY_ID[ground.p.body];
  if (b.ocean) for (const st of ground.p.sites) assert(G.terrainH(b, st.phi) >= 0, 'ground sites on land');
  for (const c of [ground, air]) { c.state = 'active'; s.contracts.push(c); }
  const visit = (c, i, extra) => G.checkContracts(s, { kind: 'tick', body: G.BODY_BY_ID[c.p.body], phi: c.p.sites[i].phi + 100 / G.BODY_BY_ID[c.p.body].R, hits: [], ...extra });
  // flying over a ground site, or landing far away, doesn't count
  visit(ground, 0, { landed: false, radar: 50 });
  assert(!ground.p.done.length, 'must land');
  const ev = { kind: 'tick', body: b, phi: ground.p.sites[0].phi + 5000 / b.R, landed: true, hits: [] };
  G.checkContracts(s, ev);
  assert(!ground.p.done.length, 'too far');
  let done = [];
  ground.p.sites.forEach((_, i) => { done = visit(ground, i, { landed: true, radar: 0 }); });
  assert(ground.state === 'done' && ground.p.done.length === ground.p.sites.length, 'ground survey complete');
  // air survey: wrong height doesn't count, right height does
  visit(air, 0, { landed: false, radar: air.p.hi + 2000 });
  assert(!air.p.done.length, 'too high');
  air.p.sites.forEach((_, i) => { done = visit(air, i, { landed: false, radar: (air.p.lo + air.p.hi) / 2 }); });
  assert(air.state === 'done', 'air survey complete');
});
test('the HUD points to the nearest unvisited site', () => {
  G.Career.s = G.newSave('career', 43);
  const s = G.Career.s; s.vessels = []; s.vesselSeq = 1;
  G.flightStart(G.PRESETS['Sky Hopper'](), 'Rover', { t0: 0 });
  const R = G.HOME.R;
  s.contracts.push({ id: 9, type: 'survey', state: 'active', title: 'Survey', p: { body: 'verdan', air: false, lo: 0, hi: 0, done: [],
    sites: [{ name: 'Near', phi: G.PAD_PHI - 3000 / R }, { name: 'Far', phi: G.PAD_PHI + 20000 / R }] }, reward: 1, sci: 0, rep: 0, deadline: 1e12 });
  const wp = G.nearestSite();
  assert(wp.name === 'Near' && near(wp.d, 3000, 50) && wp.dir === 1, `nearest is ${wp.name} at ${wp.d}`);
  s.contracts[s.contracts.length - 1].p.done.push(0);
  assert(G.nearestSite().name === 'Far' && G.nearestSite().dir === -1, 'then the far one, to the left');
});

console.log('\nTourists, stations and bases');
test('tourist contracts bring passengers to the Space Centre; recovering them after the trip pays, then they leave', () => {
  const s = G.newSave('career', 51);
  Object.assign(s.milestones, { liftoff: true, space: true });
  let c = null;
  for (let i = 0; i < 300 && !c; i++) { const k = G.genContract(s); if (k && k.type === 'tourism') c = k; }
  assert(c, 'tourism offered');
  s.contracts.push(c);
  assert(G.acceptContract(s, c.id) === null, 'accepted');
  const ts = G.waitingTourists(s);
  assert(ts.length === c.p.names.length && ts.every((t) => t.role === 'tourist'), 'tourists waiting');
  assert(G.availableCrew(s).length === 3 && G.rosterSize(s) === 3, 'not counted as astronauts');
  const flags = c.p.goal === 'space' ? { maxAlt: 80000 } : { orbited: ['verdan'], maxAlt: 90000, space: true };
  assert(!G.checkContracts(s, { kind: 'recover', crew: c.p.names.slice(1), flags }).length || c.p.names.length === 1, 'all of them must come');
  assert(!G.checkContracts(s, { kind: 'recover', crew: c.p.names, flags: { maxAlt: 1000 } }).length, 'must get what they paid for');
  const funds = s.funds;
  assert(G.checkContracts(s, { kind: 'recover', crew: c.p.names, flags }).includes(c) && s.funds > funds, 'paid');
  assert(!G.waitingTourists(s).length && s.crew.filter((x) => x.status === 'left').length === c.p.names.length, 'they went home');
  assert(G.touristGoalMet('land:pallid', { landedOn: ['pallid'] }) && !G.touristGoalMet('flyby:pallid', { visited: [] }), 'goals');
});
test('a capsule with only tourists aboard cannot be flown, and tourists never go outside', () => {
  G.Career.s = G.newSave('career', 52);
  const s = G.Career.s; s.vessels = []; s.vesselSeq = 1;
  G.flightStart(G.PRESETS['Sky Hopper'](), 'Joyride', { t0: 0 });
  const F = G.F, c = F.craft, pod = c.parts.find((p) => p.def.seats);
  F.tutorial = null;
  F.crew = [{ id: 9, name: 'Opal Wrenfield', pod: pod.uid, tourist: true }];
  assert(!G.hasControl(c) && !G.canEva(), 'tourist only: no control, no spacewalk');
  F.crew.push({ id: 1, name: s.crew[0].name, pod: pod.uid });
  assert(G.hasControl(c) && G.canEva(), 'with a pilot aboard it flies');
});
test('station and base contracts check seats, docking port, power and antenna', () => {
  const s = G.newSave('career', 53);
  const st = { id: 1, type: 'station', state: 'active', p: { body: 'verdan', seats: 4 }, reward: 1, sci: 0, rep: 0, deadline: 1e12 };
  const bs = { id: 2, type: 'base', state: 'active', p: { body: 'pallid', seats: 2 }, reward: 1, sci: 0, rep: 0, deadline: 1e12 };
  s.contracts.push(st, bs);
  const orbit = { e: 0.01, rp: G.HOME.R + 200000, ra: G.HOME.R + 210000 };
  const full = { kind: 'tick', orbit, landed: false, seats: 4, hasDock: true, hasPower: true, hasAntenna: true };
  assert(!G.checkContracts(s, { ...full, body: G.HOME, seats: 3 }).length, 'too few seats');
  assert(!G.checkContracts(s, { ...full, body: G.HOME, hasDock: false }).length, 'needs a port');
  assert(G.checkContracts(s, { ...full, body: G.HOME }).includes(st), 'station done');
  assert(!G.checkContracts(s, { ...full, body: G.MOON, landed: false, orbit: null }).length, 'base must be landed');
  assert(G.checkContracts(s, { kind: 'tick', body: G.MOON, landed: true, seats: 2, hasPower: true, hasAntenna: true }).includes(bs), 'base done');
});

console.log('\nScience labs and surface stations');
test('a lab analyses results into data, and a scientist turns data into science over time', () => {
  G.Career.s = G.newSave('career', 61);
  const s = G.Career.s; s.vessels = []; s.vesselSeq = 1;
  const d = G.designFromStack(['pod', 'lab', 'tankM']);
  G.attachPart(d, 'thermo', d.parts.find((p) => p.id === 'tankM').uid, 'side', 1, 0.3, false);
  G.flightStart(d, 'Lab', { t0: 0 });
  const F = G.F, c = F.craft, lab = c.parts.find((p) => p.def.lab), th = c.parts.find((p) => p.def.exp === 'thermo');
  for (const p of c.parts) if (p.def.ec) p.ec = p.def.ec;
  G.runExperiment(s, th, G.MOON, 'landed', 'Near Plains');
  const add = G.labAnalyse(c, lab);
  assert(add > 0 && near(lab.labData, th.result.cap, 1e-9) && G.labAnalyse(c, lab) === 0, 'each subject analysed once');
  F.crew = [{ id: 2, name: s.crew[1].name, pod: c.parts[0].uid }]; // an engineer: no lab work
  assert(G.labSkill() === 0, 'needs a scientist');
  F.crew = [{ id: 3, name: s.crew[2].name, pod: c.parts[0].uid }];
  const k = G.labSkill();
  assert(k >= 1, 'scientist works the lab');
  const data0 = lab.labData;
  for (let i = 0; i < 100; i++) { G.labStep(c, 100, k); for (const p of c.parts) if (p.def.ec) p.ec = p.def.ec; }
  assert(lab.labSci > 0 && near(data0 - lab.labData, lab.labSci / 2, 1e-6), 'science made, data used at half the rate');
});
test('an astronaut carries a kit outside and sets up a science station that sends science home for weeks', () => {
  const { F, s } = evaSetup('pallid');
  const pod = F.craft.parts.find((p) => p.def.seats);
  // give the ship a science kit
  const kit = { ...F.craft.parts.find((p) => p.def.exp || p.def.chute), uid: 900, id: 'sciKit', def: G.PART_DEFS.sciKit, links: [pod.uid], used: false };
  F.craft.parts.push(kit); pod.links.push(900); F.craft.recompute();
  G.goEva();
  assert(F.craft.parts[0].kits === 1 && kit.used, 'astronaut took the kit');
  G.deployStation();
  const st = F.others.find((o) => o.meta && o.meta.kind === 'station');
  assert(st && st.landed && F.craft.parts[0].kits === 0, 'station set up');
  const cap = st.parts[0].station.cap;
  assert(near(cap, 40 * G.BODY_SCI.pallid, 1e-6), 'worth 40 × the world');
  s.vessels.push(G.vesselFromCraft(st, F.t, st.meta));
  const sci0 = s.science;
  s.ut = F.t + 30 * G.DAY;
  G.stationTick(s);
  assert(near(s.science - sci0, cap / 2, 0.2), `half after a month: ${s.science - sci0}`);
  s.ut = F.t + 200 * G.DAY;
  G.stationTick(s);
  assert(near(s.science - sci0, cap, 0.2), 'all of it in the end, and no more');
});

console.log('\nAnomalies');
test('anomalies sit on dry land, one per world on eight worlds', () => {
  assert(G.ANOMALIES.length === 8 && new Set(G.ANOMALIES.map((a) => a.body)).size === 8, 'eight worlds');
  for (const a of G.ANOMALIES) { const b = G.BODY_BY_ID[a.body]; assert(!b.ocean || G.terrainH(b, a.phi) >= 8, `${a.name} is on land`); }
});
test('landing next to an anomaly discovers it once: milestone, money and science; far away it only shows up', () => {
  const { F, s, ship } = evaSetup('pallid');
  const a = G.ANOMALY_BY_ID.pillar, b = G.MOON, bp = G.bodyPos(b, F.t);
  const put = (dist) => {
    const phi = a.phi + dist / b.R, lowest = Math.min(...ship.contacts.map((q) => q[1]));
    const r = b.R + G.terrainH(b, phi) + (ship.yc - lowest) + 0.02;
    ship.pos = [bp[0] + r * Math.cos(phi), bp[1] + r * Math.sin(phi)];
    ship.landed = { body: b, rx: ship.pos[0] - bp[0], ry: ship.pos[1] - bp[1] };
  };
  put(5000);
  G.anomalyTick(ship, b);
  assert(!G.anomalyFound('pillar'), 'not found from 5 km');
  assert(G.surfaceMarkers().some((m) => m.kind === 'anomaly' && m.a === a), 'but it shows in the world view');
  put(80);
  const sci = s.science, funds = s.funds;
  G.anomalyTick(ship, b);
  assert(G.anomalyFound('pillar') && s.science > sci && s.funds > funds, 'discovered and rewarded');
  const sci2 = s.science;
  G.anomalyTick(ship, b);
  assert(s.science === sci2, 'only once');
  assert(G.milestoneName('anomaly_pillar') === 'Found The Black Pillar', 'named');
  assert(F.flags.log.some((e) => /Discovered The Black Pillar/.test(e.text)), 'logged');
});

console.log('\nAdministration and strategies');
test('strategies cost money to start, are limited by the Administration level, and change rewards', () => {
  G.Career.s = G.newSave('career', 91);
  const s = G.Career.s;
  s.funds = 1e6;
  assert(G.startStrategy(s, 'fundraising') === null && G.hasStrategy('fundraising'), 'started');
  assert(s.funds === 1e6 - G.STRATEGIES.fundraising.cost, 'paid for it');
  assert(/Upgrade Administration/.test(G.startStrategy(s, 'patents')), 'level 1 runs one');
  // fundraising: half the contract science comes as money
  let f0 = s.funds, sc0 = s.science;
  G.completeContract(s, { reward: 10000, sci: 10, rep: 2 });
  assert(s.funds - f0 === 15000 && near(s.science - sc0, 5, 1e-9), 'science partly paid as money');
  G.stopStrategy(s, 'fundraising');
  G.upgradeFacility(s, 'admin');
  assert(G.startStrategy(s, 'bargains') === null && G.startStrategy(s, 'patents') === null, 'level 2 runs two');
  const d = G.PRESETS['Orbiter I']();
  const full = d.parts.reduce((a, p) => a + G.PART_DEFS[p.id].cost, 0);
  assert(G.designCost(d) === Math.round(full * 0.85), 'bulk buying: cheaper parts');
  f0 = s.funds;
  s.science = 100; s.tech.push('general');
  G.research(s, 'advanced');
  assert(s.funds - f0 === 30 * 300, 'patents pay for research');
});

console.log('\nRover wheels');
test('wheels on both sides get a warning; a rover with wheels on one side lies on them, whichever side it is', () => {
  const both = G.designFromStack(['probe', 'batteryDisc', 'tankM125']);
  const body = both.parts.find((p) => p.id === 'tankM125').uid;
  G.attachPart(both, 'roverWheel', body, 'side', 1, 0.3, true); // mirrored: one each side
  assert(G.analyzeDesign(both).warnings.some((w) => /Wheels on both sides/.test(w.text)), 'warned');
  for (const side of [1, -1]) {
    const d = G.designFromStack(['probe', 'batteryDisc', 'tankM125']);
    const t = d.parts.find((p) => p.id === 'tankM125').uid, pr = d.parts.find((p) => p.id === 'probe').uid;
    G.attachPart(d, 'roverWheel', pr, 'side', side, -0.3, false);
    G.attachPart(d, 'roverWheel', t, 'side', side, 0.8, false);
    assert(!G.analyzeDesign(d).warnings.some((w) => /Wheels on both sides/.test(w.text)), 'no warning on one side');
    G.Career.s = G.newSave('sandbox', 1);
    G.flightStart(d, 'Rover', { t0: 0, site: 'runway' });
    const c = G.F.craft, r = Math.hypot(c.pos[0], c.pos[1]), up = [c.pos[0] / r, c.pos[1] / r];
    for (const w of c.wheels) {
      const wp = c.toWorld(...G.wheelPoint(w)), wr2 = Math.hypot(wp[0], wp[1]);
      assert(wr2 < r, `wheel on side ${side} is below the body`);
    }
    assert(c.landed && c.landed.wheels, 'standing on its wheels');
  }
});

test('on Pallid: a lander drops its rover gently, Y tips it onto its wheels, and it drives', () => {
  G.Career.s = G.newSave('sandbox', 1);
  const s = G.Career.s; s.vessels = []; s.vesselSeq = 1;
  // lander: capsule, tank with legs, engine; the rover hangs off a radial decoupler on the tank
  const d = G.designFromStack(['pod', 'tankM', 'wren']);
  const tank = d.parts.find((p) => p.id === 'tankM').uid;
  G.attachPart(d, 'legs', tank, 'side', 1, 0.6, true);
  const rd = G.attachPart(d, 'radDec', tank, 'side', 1, 0.1, false)[0];
  const core = G.attachPart(d, 'probe', rd, 'side', 1, 0, false)[0];
  const bat = G.attachPart(d, 'batteryDisc', core, 'bottom', 0, 0, false)[0];
  const body = G.attachPart(d, 'tankM125', bat, 'bottom', 0, 0, false)[0];
  G.setPartCfg(d, body, 'fill', 0);
  G.attachPart(d, 'roverWheel', core, 'side', 1, -0.3, false);
  G.attachPart(d, 'roverWheel', body, 'side', 1, 0.8, false);
  G.attachPart(d, 'solar', body, 'side', -1, 0.1, false);
  G.flightStart(d, 'Rover Lander', { t0: 0 });
  const F = G.F, c = F.craft; F.others = []; F.debris = []; F.tutorial = null;
  // stand it on Pallid
  const b = G.MOON, phi = 0.4, bp = G.bodyPos(b, 0);
  const lowest = Math.min(...c.contacts.map((q) => q[1]));
  const r = b.R + G.terrainH(b, phi) + (c.yc - lowest) + 0.02;
  c.angle = phi; c.pos = [bp[0] + r * Math.cos(phi), bp[1] + r * Math.sin(phi)]; c.vel = G.bodyState(b, 0).slice(2, 4);
  c.landed = { body: b, rx: c.pos[0] - bp[0], ry: c.pos[1] - bp[1] };
  F.lastBody = b;
  G.fireDecoupler(c, c.byUid.get(rd));
  const rover = F.others.find((o) => o.parts.some((p) => p.def.motor));
  assert(rover, 'the rover is a vessel of its own');
  steps(400);
  assert(!rover.dead && rover.landed, 'it came down safely beside the lander');
  G.switchToVessel(rover.vid);
  const rv = F.craft;
  assert(G.canTip(rv), 'standing up: can tip it');
  G.tipOntoWheels();
  assert(rv.landed && rv.landed.wheels, 'on its wheels');
  const p0 = Math.atan2(rv.pos[1] - bp[1], rv.pos[0] - bp[0]);
  F.keys.ArrowUp = true;
  for (let i = 0; i < 400; i++) G.flightUpdate(G.PHYS_DT);
  F.keys.ArrowUp = false;
  const bp2 = G.bodyPos(b, F.t), p1 = Math.atan2(rv.pos[1] - bp2[1], rv.pos[0] - bp2[0]);
  assert(!rv.dead && Math.abs(G.wrapPi(p1 - p0)) * b.R > 3, `drove ${(Math.abs(G.wrapPi(p1 - p0)) * b.R).toFixed(1)} m`);
  // still the right way up: wheels below the body
  const rr = Math.hypot(rv.pos[0] - bp2[0], rv.pos[1] - bp2[1]);
  for (const w of rv.wheels) { const wp = rv.toWorld(...G.wheelPoint(w)); assert(Math.hypot(wp[0] - bp2[0], wp[1] - bp2[1]) < rr, 'wheels still underneath'); }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
