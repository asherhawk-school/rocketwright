'use strict';
/* Rocketwright — guided tutorials. Each one sets up a flight and walks through steps that tick off as
   you do them. Tutorials run in a throwaway sandbox: your real save is put aside and restored after. */

const Tut = { active: null, step: 0, saved: null };

const tAlt = (c) => { const b = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], F.t), bp = bodyPos(b, F.t); return Math.hypot(c.pos[0] - bp[0], c.pos[1] - bp[1]) - b.R; };
const tVert = (c) => { const b = soiBody(c.pos[0], c.pos[1], F.t), bp = bodyPos(b, F.t), bv = bodyVel(b, F.t);
  const rx = c.pos[0] - bp[0], ry = c.pos[1] - bp[1], r = Math.hypot(rx, ry);
  return ((c.vel[0] - bv[0]) * rx + (c.vel[1] - bv[1]) * ry) / r; };
const tPitch = (c) => { const b = soiBody(c.pos[0], c.pos[1], F.t), bp = bodyPos(b, F.t);
  return 90 - (Math.abs(wrapPi(c.angle - Math.atan2(c.pos[1] - bp[1], c.pos[0] - bp[0]))) * 180) / Math.PI; };

/* Put a craft (already started with flightStart) into a circular orbit. */
function tutPlaceInOrbit(body, alt, ang) {
  const c = F.craft;
  c.landed = null;
  const st = bodyState(body, F.t), r = body.R + alt, v = Math.sqrt(body.mu / r);
  c.pos = [st[0] + r * Math.cos(ang), st[1] + r * Math.sin(ang)];
  c.vel = [st[2] - v * Math.sin(ang), st[3] + v * Math.cos(ang)];
  c.angle = ang + Math.PI / 2;
  c.angVel = 0;
  F.lastBody = body;
  F.flags.space = true;
}

const TUTORIALS = [
  {
    id: 'first', name: 'First flight', desc: 'Launch a solid booster, drop it, and come down under a parachute.',
    setup() { flightStart(PRESETS['Sky Hopper'](), 'Sky Hopper'); },
    steps: [
      { text: 'Press <kbd>Space</kbd> (or the red <b>STAGE</b> button) to light the booster.', done: (c) => c.stageIdx >= 1 },
      { text: 'Climb! The booster burns for about 40 seconds. Watch your <b>altitude</b> at the top of the screen.', done: (c) => tAlt(c) > 5000 },
      { text: 'When the booster burns out, press <kbd>Space</kbd> again to drop it.', done: (c) => c.stageIdx >= 2 },
      { text: 'You are coasting upward. Wait until you start to fall: <b>Vertical</b> speed goes below zero.', done: (c) => tVert(c) < 0 },
      { text: 'Press <kbd>Space</kbd> to open the parachute.', done: (c) => c.chuteOpen },
      { text: 'Hands off. The parachute opens fully below 1.5 km. You need to touch down slower than 6 m/s.', done: (c) => c.landed && !c.dead },
      { text: 'Well done! That is a complete flight. Press <kbd>Esc</kbd> and choose <b>Recover vessel</b>.', done: () => false },
    ],
  },
  {
    id: 'orbit', name: 'Reaching orbit', desc: 'Do a gravity turn, then plan and fly a burn to circularise.',
    setup() { flightStart(PRESETS['Orbiter I'](), 'Orbiter I'); },
    steps: [
      { text: 'Press <kbd>Space</kbd> to launch. SAS (Hold) keeps you pointing straight up.', done: (c) => c.stageIdx >= 1 && !c.landed },
      { text: 'Above 1 km, tap <kbd>D</kbd> to tilt about 10° to the right. The yellow needle on the dial shows your pitch.', done: (c) => tAlt(c) > 1000 && tPitch(c) < 84 },
      { text: 'Click <b>Pro</b> on the SAS panel (or press <kbd>3</kbd>). The rocket now follows its own path and tips over by itself: a <i>gravity turn</i>.', done: () => F.sas === 'pro' },
      { text: 'When your <b>Apoapsis</b> (top left) passes 80 km, cut the engine with <kbd>X</kbd>. Stage with <kbd>Space</kbd> if the first stage runs dry.',
        done: (c) => F.orbit && F.orbit.ra - HOME.R > 80000 && c.throttle === 0 },
      { text: 'Open the map with <kbd>M</kbd> and press <b>+ Node at Ap</b>.', done: () => !!F.node },
      { text: 'Add prograde Δv with the <b>+10</b> / <b>+100</b> buttons (or drag the green handle) until the dashed path stays above 70 km all the way round.',
        done: () => F.node && F.node.pred && F.node.pred.pts.every((p) => p.b !== HOME || Math.hypot(p.x, p.y) - HOME.R > 70000) },
      { text: 'Stage to your upper stage if you haven\'t yet, then speed up time with <kbd>.</kbd>. Warp stops just before the burn.',
        done: (c) => F.node && F.t > F.node.t - burnTime(c, Math.hypot(F.node.pro, F.node.rad)) / 2 - 40 },
      { text: 'Set SAS to <b>Node</b> (<kbd>7</kbd>). When the panel says start, throttle up with <kbd>Z</kbd>. The engine cuts itself when the burn is done.',
        done: () => !F.node && F.orbit && F.orbit.rp - HOME.R > 70000 },
      { text: 'You\'re in orbit! 🎉 Try the map, time warp, or plan a trip to Pallid.', done: () => false },
    ],
  },
  {
    id: 'dock', name: 'Docking', desc: 'Close in on a station with RCS and dock with it.',
    setup() {
      const d = designFromStack(['dockPort', 'pod', 'tankS125', 'gnat']);
      const pod = d.parts.find((p) => p.id === 'pod').uid;
      attachPart(d, 'rcs', pod, 'side', 1, 0.5, true);
      attachPart(d, 'monoPod', d.parts.find((p) => p.id === 'tankS125').uid, 'side', 1, 0, true);
      flightStart(d, 'Shuttle');
      F.craft.activateNext(null);
      F.craft.throttle = 0;
      tutPlaceInOrbit(HOME, 150000, 0);
      const c = F.craft, r = Math.hypot(c.pos[0], c.pos[1]), ang = 80 / r;
      // the station sits 80 m ahead, turning with its orbit so its port keeps facing back toward us
      const st = Career.s;
      const parts = layoutDesign(designFromStack(['dockPort', 'probe', 'batteryRing']));
      const k = new Craft(parts), v = Math.hypot(c.vel[0], c.vel[1]);
      k.pos = [r * Math.cos(ang), r * Math.sin(ang)];
      k.vel = [-v * Math.sin(ang), v * Math.cos(ang)];
      k.angle = ang - Math.PI / 2;
      k.angVel = v / r;
      c.angVel = v / r;
      k.vid = st.vesselSeq++;
      k.meta = { id: k.vid, name: 'Station Alpha', crew: [], launchT: F.t, flags: { space: true, maxAlt: 0, visited: [], landedOn: [] }, kind: 'ship' };
      F.others.push(k);
      setTarget('v' + k.vid);
      F.sas = 'off';
      updateSasButtons();
    },
    steps: [
      { text: 'Station Alpha is about 80 m ahead (pink marker on the dial). Turn on RCS with <kbd>R</kbd>.', done: (c) => c.rcsOn },
      { text: 'Set SAS to <b>Tgt</b> (<kbd>8</kbd>). Up close, it turns you to face the station\'s docking port. Your own port is on your nose.', done: () => F.sas === 'tgt' },
      { text: 'Look at <b>Docking ports</b> on the target card. Slide sideways with <kbd>Q</kbd>/<kbd>E</kbd> until the sideways gap is near zero.',
        done: (c) => { const ts = targetState(F.target); const di = ts && ts.craft && dockingInfo(c, ts.craft); return !di || Math.abs(di.lateral) < 1.5; } },
      { text: 'Now move in with <kbd>H</kbd> (forward thrusters). Keep <b>Relative speed</b> under 1 m/s near the end; <kbd>N</kbd> slows you down. Keep correcting sideways with <kbd>Q</kbd>/<kbd>E</kbd>.',
        done: (c) => dockedPairs(c).length > 0 },
      { text: 'Docked! 🎉 Press <kbd>U</kbd> to undock again.', done: () => false },
    ],
  },
  {
    id: 'land', name: 'Landing on Pallid', desc: 'Drop out of orbit and land on the moon with your engine.',
    setup() {
      flightStart(PRESETS['Pallid Lander'](), 'Pallid Lander');
      const c = F.craft;
      while (c.stageIdx < c.stages.length && !c.engines.some((e) => e.ignited && e.def.name.startsWith('Wren'))) c.activateNext(null);
      c.throttle = 0;
      F.t = 0;
      tutPlaceInOrbit(MOON, 30000, 1.2);
      F.flags.visited.push('pallid');
    },
    steps: [
      { text: 'You\'re orbiting Pallid at 30 km in the lander. Point <b>Retro</b> (<kbd>4</kbd>), against your direction of travel.', done: () => F.sas === 'retro' },
      { text: 'Burn with <kbd>Shift</kbd> or <kbd>Z</kbd> until the map (<kbd>M</kbd>) shows an <b>Impact</b> marker, then cut the engine with <kbd>X</kbd>.',
        done: (c) => F.orbit && F.orbit.rp < MOON.R + 2000 && c.throttle === 0 },
      { text: 'Speed up time with <kbd>.</kbd> while you fall. Warp drops back automatically as the ground gets close.', done: (c) => c.radar < 8000 },
      { text: 'Keep SAS on Retro and burn to slow down. A good rule: keep your speed below a tenth of your radar altitude.', done: (c) => c.radar < 500 },
      { text: 'Gently now. Touch down slower than 12 m/s on the landing legs.', done: (c) => c.landed && !c.dead },
      { text: 'Footprints on Pallid! 🎉', done: () => false },
    ],
  },
];

function startTutorial(id) {
  const tut = TUTORIALS.find((x) => x.id === id);
  if (!tut) return;
  Tut.saved = Career.s ? JSON.stringify(Career.s) : null;
  Career.noPersist = true;
  Career.s = newSave('sandbox', 1);
  universe();
  Tut.active = tut;
  Tut.step = 0;
  hideModal();
  showScreen('flight');
  resizeFlight();
  tut.setup();
  F.canRevert = false;
  F.tutorial = true;
  fillTargetSelect();
  renderTutorial();
}

function endTutorial() {
  if (!Tut.active) return;
  Tut.active = null;
  F.tutorial = false;
  Career.noPersist = false;
  Career.s = Tut.saved ? JSON.parse(Tut.saved) : null;
  Tut.saved = null;
  document.getElementById('tutCard').classList.add('hidden');
}

function tutorialTick() {
  const tut = Tut.active;
  if (!tut || F.craft.dead) return;
  const st = tut.steps[Tut.step];
  if (st && st.done(F.craft) && Tut.step < tut.steps.length - 1) {
    Tut.step++;
    playSound('click');
    renderTutorial();
  }
}

function renderTutorial() {
  const el = document.getElementById('tutCard');
  const tut = Tut.active;
  if (!tut) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const n = tut.steps.length;
  el.innerHTML = `<div class="card-title">Tutorial · ${tut.name} <span class="muted">${Math.min(Tut.step + 1, n)}/${n}</span></div>
    <div class="tut-text">${tut.steps[Tut.step].text}</div>
    <div class="tut-dots">${tut.steps.map((_, i) => `<span class="${i < Tut.step ? 'done' : i === Tut.step ? 'now' : ''}"></span>`).join('')}</div>`;
}
