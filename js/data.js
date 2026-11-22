'use strict';
/* Rocketwright — shared constants, parts, celestial bodies and orbital math. */

const G0 = 9.80665;
const TAU = Math.PI * 2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function wrapPi(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixColor(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
}

/* ---------- formatting ---------- */
function fmtNum(n, d = 0) {
  return n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
}
function fmtDist(m) {
  if (!isFinite(m)) return '—';
  const a = Math.abs(m);
  if (a < 10000) return fmtNum(m) + ' m';
  if (a < 1e7) return fmtNum(m / 1000, 1) + ' km';
  return fmtNum(m / 1000) + ' km';
}
function fmtDur(s) {
  if (!isFinite(s) || s < 0) return '—';
  s = Math.floor(s);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m ${sec}s`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}
function fmtClock(s) {
  s = Math.floor(s);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `T+ ${d ? d + 'd ' : ''}${p(h)}:${p(m)}:${p(sec)}`;
}

/* ---------- persistence ---------- */
const Store = {
  get(k, d) { try { const v = localStorage.getItem('rw.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('rw.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};

/* ---------- parts ----------
   Units: mass in tonnes, thrust in kN, so kN / t = m/s². Sizes in metres.
   w = width at the top, wb = width at the bottom (defaults to w).
   radial: attaches to the side of other parts. radialOut: other parts can attach to its outer side.
   noTop / noBottom: the part has no stack node there. */
const PART_DEFS = {
  // Command
  pod: { kind: 'pod', name: 'Lark Capsule', cat: 'Command', mass: 0.85, h: 1.6, w: 0.9, wb: 2, torque: 10, mono: 0.1, pod: true,
    desc: 'One-seat command capsule with reaction wheels and a little monopropellant. Every craft needs one.' },
  chute: { kind: 'chute', name: 'Canopy Parachute', cat: 'Command', mass: 0.1, h: 0.45, w: 0.9, chute: true, noTop: true,
    desc: 'Goes on top of the capsule. Opens partly when staged and fully below 1.5 km.' },
  wheel: { kind: 'wheel', name: 'Gyro Ring', cat: 'Command', mass: 0.2, h: 0.4, w: 2, torque: 30,
    desc: 'Strong reaction wheel for steering heavy rockets.' },
  // Fuel
  tankS125: { kind: 'tank', name: 'Tank S-1 Slim', cat: 'Fuel', mass: 0.06, fuel: 0.5, h: 1.0, w: 1.25, desc: 'Small 1.25 m fuel tank.' },
  tankM125: { kind: 'tank', name: 'Tank M-2 Slim', cat: 'Fuel', mass: 0.12, fuel: 1, h: 1.9, w: 1.25, desc: 'Medium 1.25 m fuel tank.' },
  tankS: { kind: 'tank', name: 'Tank S-1', cat: 'Fuel', mass: 0.125, fuel: 1, h: 1.0, w: 2, desc: 'Small 2 m fuel tank.' },
  tankM: { kind: 'tank', name: 'Tank M-2', cat: 'Fuel', mass: 0.25, fuel: 2, h: 1.9, w: 2, desc: 'Medium 2 m fuel tank.' },
  tankL: { kind: 'tank', name: 'Tank L-4', cat: 'Fuel', mass: 0.5, fuel: 4, h: 3.7, w: 2, desc: 'Large 2 m fuel tank.' },
  tankXL: { kind: 'tank', name: 'Tank XL-8', cat: 'Fuel', mass: 1.0, fuel: 8, h: 7.2, w: 2, desc: 'Huge 2 m fuel tank.' },
  tankT12: { kind: 'tank', name: 'Tank T-12 Wide', cat: 'Fuel', mass: 1.5, fuel: 12, h: 4.0, w: 3, desc: 'Wide 3 m fuel tank.' },
  tankT24: { kind: 'tank', name: 'Tank T-24 Wide', cat: 'Fuel', mass: 3.0, fuel: 24, h: 7.6, w: 3, desc: 'Huge 3 m fuel tank for heavy launchers.' },
  saddle: { kind: 'radtank', name: 'Saddle Tank', cat: 'Fuel', radial: true, mass: 0.08, fuel: 0.6, h: 2.2, w: 0.8,
    desc: 'Side-mounted fuel tank. Feeds engines in the same stage.' },
  monoPod: { kind: 'monotank', name: 'Monoprop Pod', cat: 'Fuel', radial: true, mass: 0.05, mono: 0.3, h: 1.1, w: 0.6,
    desc: 'Side-mounted monopropellant for RCS thrusters.' },
  // Engines
  gnat: { kind: 'engine', name: 'Gnat Micro Engine', cat: 'Engines', mass: 0.2, h: 0.7, w: 1.25, thrust: 20, ispVac: 320, ispSL: 250,
    gimbal: 3, bell: 0.9, desc: 'Tiny 1.25 m engine for probes and small landers.' },
  wren: { kind: 'engine', name: 'Wren Vacuum Engine', cat: 'Engines', mass: 0.5, h: 1.1, w: 2, thrust: 60, ispVac: 345, ispSL: 170,
    gimbal: 4, bell: 1.5, desc: 'Very efficient in space, weak in thick air. Ideal upper stage or lander.' },
  kestrel: { kind: 'engine', name: 'Kestrel Engine', cat: 'Engines', mass: 1.0, h: 1.3, w: 2, thrust: 150, ispVac: 315, ispSL: 260,
    gimbal: 3, bell: 1.6, desc: 'Good all-rounder for middle stages.' },
  ox: { kind: 'engine', name: 'Ox Lifter Engine', cat: 'Engines', mass: 1.6, h: 1.6, w: 2, thrust: 280, ispVac: 300, ispSL: 275,
    gimbal: 2, bell: 1.8, desc: 'Strong first-stage engine.' },
  bison: { kind: 'engine', name: 'Bison Heavy Engine', cat: 'Engines', mass: 3.2, h: 2.0, w: 2, thrust: 620, ispVac: 295, ispSL: 270,
    gimbal: 1.5, bell: 1.95, desc: 'Huge thrust for heavy launchers.' },
  colossus: { kind: 'engine', name: 'Colossus Engine', cat: 'Engines', mass: 7, h: 2.6, w: 3, thrust: 1500, ispVac: 300, ispSL: 280,
    gimbal: 1.5, bell: 2.9, desc: 'Enormous 3 m first-stage engine.' },
  sparrow: { kind: 'engine', name: 'Sparrow Radial Engine', cat: 'Engines', radial: true, mass: 0.25, h: 1.3, w: 0.7, thrust: 45,
    ispVac: 300, ispSL: 255, gimbal: 3, bell: 0.6, desc: 'Small side-mounted engine. Use in symmetric pairs.' },
  popper: { kind: 'srb', name: 'Popper Solid Booster', cat: 'Engines', mass: 0.3, solid: 1.6, h: 3.0, w: 1.25, thrust: 110,
    ispVac: 205, ispSL: 190, gimbal: 0, desc: 'Small 1.25 m solid booster. Burns at full power until empty.' },
  srb: { kind: 'srb', name: 'Thumper Solid Booster', cat: 'Engines', mass: 0.8, solid: 4.5, h: 4.4, w: 2, thrust: 240, ispVac: 215,
    ispSL: 195, gimbal: 0, desc: 'Cheap, brutal thrust. Burns at full power until empty; cannot be throttled.' },
  // Coupling
  decoupler125: { kind: 'decoupler', name: 'Stack Decoupler S', cat: 'Coupling', mass: 0.03, h: 0.3, w: 1.25, decoupler: true,
    desc: 'Separates everything below it (1.25 m).' },
  decoupler: { kind: 'decoupler', name: 'Stack Decoupler', cat: 'Coupling', mass: 0.05, h: 0.35, w: 2, decoupler: true,
    desc: 'Separates everything below it when staged. Each decoupler starts a new stage.' },
  decoupler3: { kind: 'decoupler', name: 'Stack Decoupler W', cat: 'Coupling', mass: 0.1, h: 0.4, w: 3, decoupler: true,
    desc: 'Separates everything below it (3 m).' },
  radDec: { kind: 'raddec', name: 'Radial Decoupler', cat: 'Coupling', radial: true, radialOut: true, decoupler: true, mass: 0.03,
    h: 1.0, w: 0.4, desc: 'Holds a side booster or tank, then pushes it away when staged.' },
  radDecX: { kind: 'raddec', name: 'Crossfeed Decoupler', cat: 'Coupling', radial: true, radialOut: true, decoupler: true,
    crossfeed: true, mass: 0.05, h: 1.0, w: 0.4, desc: 'Radial decoupler that lets fuel flow from the side booster into the core.' },
  twinMount: { kind: 'mount', name: 'Twin Engine Mount', cat: 'Coupling', mass: 0.1, h: 0.45, w: 2, wb: 2.5, noBottom: true,
    slots: [-0.625, 0.625], desc: 'Goes under a 2 m tank. Holds two 1.25 m engines (or tanks) side by side.' },
  twinMountL: { kind: 'mount', name: 'Twin Engine Mount L', cat: 'Coupling', mass: 0.25, h: 0.6, w: 2, wb: 4, noBottom: true,
    slots: [-1, 1], desc: 'Goes under a 2 m tank and flares out. Holds two 2 m engines side by side.' },
  triMount: { kind: 'mount', name: 'Tri Engine Mount', cat: 'Coupling', mass: 0.2, h: 0.55, w: 3, wb: 3.75, noBottom: true,
    slots: [-1.25, 0, 1.25], desc: 'Goes under a 3 m tank. Holds three 1.25 m engines side by side.' },
  quadMount: { kind: 'mount', name: 'Quad Engine Mount', cat: 'Coupling', mass: 0.35, h: 0.6, w: 3, wb: 5, noBottom: true,
    slots: [-1.875, -0.625, 0.625, 1.875], desc: 'Goes under a 3 m tank and flares out. Holds four 1.25 m engines side by side.' },
  adapt2to125: { kind: 'adapter', name: 'Taper 2 → 1.25', cat: 'Coupling', mass: 0.08, h: 0.8, w: 2, wb: 1.25, desc: 'Adapter from 2 m above to 1.25 m below.' },
  adapt125to2: { kind: 'adapter', name: 'Taper 1.25 → 2', cat: 'Coupling', mass: 0.08, h: 0.8, w: 1.25, wb: 2, desc: 'Adapter from 1.25 m above to 2 m below.' },
  adapt3to2: { kind: 'adapter', name: 'Taper 3 → 2', cat: 'Coupling', mass: 0.15, h: 1.0, w: 3, wb: 2, desc: 'Adapter from 3 m above to 2 m below.' },
  adapt2to3: { kind: 'adapter', name: 'Taper 2 → 3', cat: 'Coupling', mass: 0.15, h: 1.0, w: 2, wb: 3, desc: 'Adapter from 2 m above to 3 m below.' },
  // Structure
  nose125: { kind: 'nose', name: 'Ogive Nose Cone S', cat: 'Structure', mass: 0.03, h: 1.2, w: 0.15, wb: 1.25, noTop: true,
    desc: 'Streamlined cap for 1.25 m boosters and tanks.' },
  nose2: { kind: 'nose', name: 'Ogive Nose Cone', cat: 'Structure', mass: 0.08, h: 1.8, w: 0.2, wb: 2, noTop: true,
    desc: 'Streamlined cap for 2 m boosters and tanks.' },
  pylon: { kind: 'pylon', name: 'Pylon Strut', cat: 'Structure', radial: true, radialOut: true, mass: 0.1, h: 2.4, w: 0.5,
    desc: 'Side-mounted strut. Attach tanks or engines to its outer side.' },
  fins: { kind: 'fins', name: 'Tailfin', cat: 'Structure', radial: true, fins: true, mass: 0.06, h: 2.2, w: 0.9,
    desc: 'Keeps the rocket pointed into the airflow. Mount in pairs near the bottom.' },
  // Utility
  legs: { kind: 'legs', name: 'Stance Landing Leg', cat: 'Utility', radial: true, legs: true, mass: 0.07, h: 1.2, w: 0.45,
    desc: 'Mount in pairs. Raises the safe landing speed to 12 m/s.' },
  rcs: { kind: 'rcs', name: 'Puffer RCS Block', cat: 'Utility', radial: true, rcs: true, mass: 0.05, h: 0.45, w: 0.45, rcsThrust: 1.2,
    isp: 240, desc: 'Monopropellant thrusters for fine steering and sideways moves. R toggles RCS; Q/E and H/N translate.' },
};
Object.assign(PART_DEFS, {
  // Science (career mode): each runs an experiment you can transmit or bring home
  thermo: { kind: 'sensor', name: 'Thermo Probe', cat: 'Science', radial: true, mass: 0.01, h: 0.5, w: 0.3, exp: 'thermo',
    desc: 'Measures temperature. Works anywhere.' },
  baro: { kind: 'sensor', name: 'Pressure Gauge', cat: 'Science', radial: true, mass: 0.02, h: 0.45, w: 0.35, exp: 'baro', dial: true,
    desc: 'Measures air pressure. Works anywhere, best in an atmosphere.' },
  jar: { kind: 'jar', name: 'Sample Canister', cat: 'Science', radial: true, mass: 0.05, h: 0.9, w: 0.55, exp: 'jar',
    desc: 'Collects one sample per flight. Valuable, but can only be used once until recovered.' },
  seismic: { kind: 'spike', name: 'Seismic Spike', cat: 'Science', radial: true, mass: 0.04, h: 1.0, w: 0.3, exp: 'seismic',
    desc: 'Listens to the ground. Only works while landed.' },
  sniffer: { kind: 'sniffer', name: 'Air Sniffer', cat: 'Science', radial: true, mass: 0.05, h: 0.7, w: 0.45, exp: 'sniffer',
    desc: 'Samples the air. Only works while flying in an atmosphere.' },
  antenna: { kind: 'antenna', name: 'Whip Antenna', cat: 'Science', radial: true, mass: 0.01, h: 1.6, w: 0.2, antenna: true,
    desc: 'Lets you transmit science home (for half its value). Also needed for satellite contracts.' },
});
PART_DEFS.pod.exp = 'crew';
Object.assign(PART_DEFS.pod, { ec: 60, maxTemp: 2200 });
Object.assign(PART_DEFS, {
  // Electricity and survival
  probe: { kind: 'probe', name: 'Seed Probe Core', cat: 'Command', mass: 0.1, h: 0.5, w: 1.25, torque: 3, ec: 20, probe: true,
    desc: 'Flies a craft with no crew. Needs electricity: with a flat battery it cannot steer, throttle or stage.' },
  battery: { kind: 'battery', name: 'Cell Pack', cat: 'Utility', radial: true, mass: 0.01, h: 0.5, w: 0.35, ec: 100,
    desc: 'Small side-mounted battery: 100 units of charge.' },
  batteryRing: { kind: 'batring', name: 'Battery Ring', cat: 'Utility', mass: 0.06, h: 0.3, w: 2, ec: 500,
    desc: 'A 2 m ring of batteries: 500 units of charge.' },
  solar: { kind: 'solar', name: 'Sunwing Panel', cat: 'Utility', radial: true, mass: 0.02, h: 1.6, w: 0.25, solar: 1.6,
    desc: 'Makes power in sunlight (1.6 per second at Verdan, less further from Helion). Faces outward from where it is mounted.' },
  shield2: { kind: 'shield', name: 'Ablator Shield', cat: 'Structure', mass: 0.2, ablator: 0.25, h: 0.3, w: 2, maxTemp: 3300,
    desc: 'Goes under a 2 m capsule. Burns away slowly to protect what is behind it during reentry.' },
  chuteRadial: { kind: 'chuteSide', name: 'Side Canopy', cat: 'Command', radial: true, chute: true, mass: 0.08, h: 0.8, w: 0.35,
    desc: 'A parachute that mounts on the side, for capsules whose top is taken (by a docking port, say). Use in pairs.' },
  dockPort: { kind: 'dock', name: 'Clasp Docking Port', cat: 'Utility', mass: 0.05, h: 0.35, w: 1.25, dock: true,
    desc: 'Put it at the very top or bottom of a craft. Bring two free ports together slowly (under 1 m/s) to dock; undock from the HUD.' },
  shield125: { kind: 'shield', name: 'Ablator Shield S', cat: 'Structure', mass: 0.08, ablator: 0.1, h: 0.25, w: 1.25, maxTemp: 3300,
    desc: 'Heat shield for 1.25 m craft.' },
});

Object.assign(PART_DEFS.pod, { seats: 1 });
Object.assign(PART_DEFS.chute, { chuteFull: 720, chuteSemi: 45 });
Object.assign(PART_DEFS.chuteRadial, { chuteFull: 400, chuteSemi: 25 });
Object.assign(PART_DEFS, {
  // Reentry and recovery
  shield3: { kind: 'shield', name: 'Ablator Shield W', cat: 'Structure', mass: 0.45, ablator: 0.6, h: 0.4, w: 3, maxTemp: 3300,
    desc: 'Heat shield for 3 m capsules like the Heron.' },
  bloom: { kind: 'bloom', name: 'Bloom Heat Shield', cat: 'Structure', mass: 0.4, h: 0.4, w: 1.25, wOpen: 6, maxTemp: 2600,
    inflate: true, desc: 'Packs small, then inflates into a 6 m shield. The huge disc slows you high in thin air, so it never gets as hot. Inflate it from the part menu or by staging. It can\'t be packed again.' },
  chuteDrogue: { kind: 'drogue', name: 'Streamer Drogue', cat: 'Command', mass: 0.08, h: 0.4, w: 0.9, chute: true, drogue: true,
    noTop: true, chuteFull: 70, chuteSemi: 22, desc: 'A small, tough parachute that can open at high speed. It steadies and slows the capsule so the main canopy can open safely.' },
  chuteBig: { kind: 'chute', name: 'Great Canopy', cat: 'Command', mass: 0.25, h: 0.55, w: 1.4, chute: true, noTop: true,
    chuteFull: 1800, chuteSemi: 90, desc: 'A big parachute for the 3-seat Heron capsule and other heavy craft.' },
  airbrake: { kind: 'airbrake', name: 'Flap Brake', cat: 'Utility', radial: true, mass: 0.05, h: 1.0, w: 0.3, maxTemp: 2400,
    brakeArea: 5, desc: 'A panel that swings out into the airflow to slow you down. Toggle with K or from the part menu. Mount in pairs near the back.' },
  // Advanced engines
  hearth: { kind: 'engine', name: 'Hearth Atomic Engine', cat: 'Engines', mass: 3.0, h: 2.4, w: 1.25, thrust: 60, ispVac: 800,
    ispSL: 185, gimbal: 1, bell: 1.05, nuclear: true, desc: 'A reactor heats fuel to make thrust. Low thrust and heavy, but more than twice as efficient as any rocket engine in space.' },
  whisper: { kind: 'ion', name: 'Whisper Ion Drive', cat: 'Engines', mass: 0.25, h: 0.55, w: 1.25, thrust: 2.5, ispVac: 4200, ispSL: 100,
    gimbal: 0, prop: 'gas', ecUse: 9, desc: 'Electric thruster with a very gentle push and amazing efficiency. Burns argon (from argon tanks anywhere on the craft) and 9 charge per second.' },
  spindle: { kind: 'aerospike', name: 'Spindle Aerospike', cat: 'Engines', mass: 1.0, h: 1.3, w: 1.25, thrust: 180, ispVac: 340, ispSL: 325,
    gimbal: 0, desc: 'Keeps nearly the same efficiency from the ground up to space, so one engine can do the whole climb. No gimbal.' },
  puff: { kind: 'engine', name: 'Puff Monoprop Engine', cat: 'Engines', mass: 0.08, h: 0.5, w: 1.25, thrust: 18, ispVac: 250, ispSL: 120,
    gimbal: 0, bell: 0.55, prop: 'mono', desc: 'A small engine that burns monopropellant from anywhere on the craft. Good for tiny probes and landers.' },
  gasTank: { kind: 'gastank', name: 'Argon Flask', cat: 'Fuel', radial: true, mass: 0.03, gas: 0.08, h: 0.8, w: 0.45,
    desc: 'Side-mounted argon tank for ion drives.' },
  gasDrum: { kind: 'gasdrum', name: 'Argon Drum', cat: 'Fuel', mass: 0.12, gas: 0.45, h: 0.8, w: 1.25, desc: '1.25 m argon tank for ion drives.' },
  // Crew and structure
  heron: { kind: 'pod3', name: 'Heron Capsule', cat: 'Command', mass: 2.6, h: 2.2, w: 1.4, wb: 3, torque: 15, mono: 0.3, pod: true,
    seats: 3, ec: 150, maxTemp: 2200, exp: 'crew', desc: 'A 3 m capsule with three seats, stronger reaction wheels and more power. Pair it with the Great Canopy and a 3 m heat shield.' },
  cabin: { kind: 'cabin', name: 'Bunkhouse Module', cat: 'Utility', mass: 1.2, h: 2.0, w: 2, seats: 4, maxTemp: 2000,
    desc: 'Room for four astronauts. It can\'t fly the craft on its own; it needs a capsule or probe core too.' },
  fairing2: { kind: 'fairing', name: 'Shell Fairing', cat: 'Structure', mass: 0.1, h: 0.3, w: 2, shellW: 2.3, fairing: true,
    desc: 'Put your payload on top of it. A smooth shell covers whatever sits above it (set the height), cutting drag and heat. Staging splits the shell open and throws it away.' },
  fairing3: { kind: 'fairing', name: 'Shell Fairing W', cat: 'Structure', mass: 0.2, h: 0.35, w: 3, shellW: 3.4, fairing: true,
    desc: 'A 3 m fairing for big payloads.' },
  strut: { kind: 'strut', name: 'Brace Strut', cat: 'Structure', radial: true, mass: 0.01, h: 1.4, w: 0.25,
    desc: 'A diagonal brace for side boosters and tanks. Craft here are rigid, so struts are for looks, and they cost very little.' },
  batteryDisc: { kind: 'batring', name: 'Battery Disc', cat: 'Utility', mass: 0.03, h: 0.25, w: 1.25, ec: 400,
    desc: 'A 1.25 m disc of batteries: 400 units of charge.' },
  batteryBank: { kind: 'batbank', name: 'Battery Bank', cat: 'Utility', mass: 0.2, h: 0.8, w: 2, ec: 2500,
    desc: 'A big 2 m battery: 2,500 units of charge.' },
  fuelCell: { kind: 'fuelcell', name: 'Fuel Cell', cat: 'Utility', radial: true, mass: 0.05, h: 0.6, w: 0.45, cellEC: 1.5,
    desc: 'Turns rocket fuel from its own stage into power (1.5 per second) whenever the batteries aren\'t full. Can be switched off.' },
  fuelCellL: { kind: 'fuelcellL', name: 'Fuel Cell Array', cat: 'Utility', mass: 0.25, h: 0.6, w: 1.25, cellEC: 12,
    desc: 'A 1.25 m stack of fuel cells: 12 power per second from rocket fuel.' },
});
/* fuel (tonnes) a fuel cell burns per unit of charge */
const CELL_FUEL_PER_EC = 2e-5;
/* fairing shell mass per metre of height, by base width */
const SHELL_MASS_PER_M = 0.025;

/* What each part costs in career mode (fuel included). */
const PART_COSTS = {
  pod: 600, chute: 400, wheel: 900,
  tankS125: 150, tankM125: 280, tankS: 250, tankM: 450, tankL: 850, tankXL: 1600, tankT12: 2600, tankT24: 5000, saddle: 300, monoPod: 250,
  gnat: 400, wren: 1100, kestrel: 1300, ox: 2000, bison: 4500, colossus: 12000, sparrow: 450, popper: 120, srb: 400,
  decoupler125: 150, decoupler: 300, decoupler3: 600, radDec: 350, radDecX: 500,
  adapt2to125: 200, adapt125to2: 200, twinMount: 300, twinMountL: 500, triMount: 600, quadMount: 800, adapt3to2: 400, adapt2to3: 400,
  nose125: 150, nose2: 250, pylon: 200, fins: 150, legs: 300, rcs: 450,
  thermo: 250, baro: 400, jar: 600, seismic: 900, sniffer: 1200, antenna: 300,
  probe: 700, battery: 150, batteryRing: 600, solar: 500, shield2: 600, shield125: 300, dockPort: 800, chuteRadial: 450,
  shield3: 1100, bloom: 2200, chuteDrogue: 400, chuteBig: 900, airbrake: 450, hearth: 9000, whisper: 7000, spindle: 3800, puff: 500,
  gasTank: 400, gasDrum: 1500, heron: 3800, cabin: 2500, fairing2: 600, fairing3: 1100, strut: 40, batteryDisc: 400, batteryBank: 1800,
  fuelCell: 700, fuelCellL: 3000,
};
for (const id in PART_DEFS) PART_DEFS[id].cost = PART_COSTS[id] || 100;

const CATEGORIES = ['Command', 'Fuel', 'Engines', 'Coupling', 'Structure', 'Utility', 'Science'];

/* Adjustable settings, per kind of part. They're stored on each part as cfg[key]. */
const SETTING_DEFS = {
  deployAlt: { label: 'Opens fully below', min: 150, max: 3000, step: 50, def: 1500, unit: 'm',
    fmt: (v) => `${fmtNum(v)} m (${fmtNum(Math.round(v * 3.281 / 10) * 10)} ft)` },
  thrustLimit: { label: 'Thrust limit', min: 0, max: 100, step: 5, def: 100, unit: '%', fmt: (v) => `${v}%` },
  srbLimit: { label: 'Thrust limit', min: 30, max: 100, step: 5, def: 100, unit: '%', fmt: (v) => `${v}% (burns longer when lower)` },
  fill: { label: 'Load', min: 0, max: 100, step: 5, def: 100, unit: '%', fmt: (v) => `${v}%` },
  drogueAlt: { label: 'Opens fully below', min: 1000, max: 15000, step: 250, def: 6000, unit: 'm',
    fmt: (v) => `${fmtNum(v)} m (${fmtNum(Math.round(v * 3.281 / 100) * 100)} ft)` },
  fairH: { label: 'Shell height', min: 1, max: 16, step: 0.5, def: 5, unit: 'm', fmt: (v) => `${v} m` },
};
function partSettingKeys(def) {
  if (def.drogue) return ['drogueAlt'];
  if (def.chute) return ['deployAlt'];
  if (def.fairing) return ['fairH'];
  if (def.thrust && !def.rcs) return [def.solid ? 'srbLimit' : 'thrustLimit'];
  if (def.fuel || def.mono || def.gas) return ['fill'];
  return [];
}
function cfgVal(p, key) {
  const v = p.cfg && p.cfg[key];
  return v === undefined || v === null ? SETTING_DEFS[key].def : v;
}

/* Verdan milestones; every other body gets its own (see bodyMilestones). */
const MILESTONES = [
  { id: 'liftoff', name: 'Liftoff', desc: 'Leave the launch pad.' },
  { id: 'alt10k', name: 'Into the Blue', desc: 'Reach 10 km altitude.' },
  { id: 'space', name: 'Edge of Space', desc: 'Climb above 70 km, the top of Verdan\'s atmosphere.' },
  { id: 'orbit', name: 'Orbit!', desc: 'Reach a stable orbit around Verdan (periapsis above 70 km).' },
  { id: 'splash', name: 'Safe Return', desc: 'Land or splash down on Verdan after reaching space.' },
];
const MILESTONE_KINDS = [
  { k: 'soi', label: 'Reach', desc: (b) => `Enter ${b.name}'s sphere of influence.` },
  { k: 'orbit', label: 'Orbit', desc: (b) => `Reach a stable orbit around ${b.name}.` },
  { k: 'land', label: 'Land', desc: (b) => `Land safely on ${b.name}.`, solid: true },
  { k: 'return', label: 'Return', desc: (b) => `Land on ${b.name}, then come home safely to Verdan.`, solid: true },
];
/* Old saves used these ids for Pallid. */
const OLD_MILESTONE_IDS = { moonSoi: 'soi_pallid', moonOrbit: 'orbit_pallid', moonLand: 'land_pallid', roundTrip: 'return_pallid' };
/* Career saves keep their own milestones (they pay out, and a revert undoes them); sandbox uses a global list. */
function careerMilestones() { return typeof Career !== 'undefined' && Career.s && Career.s.mode === 'career' ? Career.s.milestones : null; }
function saveMilestones(got) {
  if (careerMilestones()) { Career.s.milestones = got; persist(); } else if (!(typeof Career !== 'undefined' && Career.noPersist)) Store.set('milestones', got);
}
function loadMilestones() {
  const cm = careerMilestones();
  if (cm) return cm;
  const got = Store.get('milestones', {});
  let changed = false;
  for (const [o, n] of Object.entries(OLD_MILESTONE_IDS)) if (got[o]) { got[n] = got[n] || got[o]; delete got[o]; changed = true; }
  if (changed) Store.set('milestones', got);
  return got;
}
function milestoneName(id) {
  const m = MILESTONES.find((x) => x.id === id);
  if (m) return m.name;
  const [k, bid] = id.split('_');
  const kind = MILESTONE_KINDS.find((x) => x.k === k), b = BODY_BY_ID[bid];
  return kind && b ? `${kind.label} ${b.name}` : id;
}

/* ---------- celestial bodies ----------
   A tree rooted at the star Helion. Orbits are circular and in one plane. The world frame is centred on
   (and moves with) Verdan, so everything near home stays small and precise; other bodies move around it. */
function makeBody(o) {
  return Object.assign({
    parent: null, orbitR: 0, phase0: 0, atmo: null, ocean: false, gas: false, star: false, children: [],
    terrain: [], hOff: 0, sky: null, colLand: '#999999', colSoil: '#666666', colWater: '#2a66ad', colMap: '#999999',
  }, o);
}
const SUN = makeBody({ id: 'helion', name: 'Helion', R: 2.0e8, mu: 1.2e18, star: true,
  colMap: '#ffd35a', colLand: '#fff1b8', colSoil: '#ffb52e', desc: 'The star at the centre of the system. Do not get close.' });
const CINDER = makeBody({ id: 'cinder', name: 'Cinder', parent: SUN, orbitR: 4.5e9, phase0: 4.0, R: 220000, mu: 3.5 * 2.2e5 * 2.2e5,
  terrain: [[1400, 3, 0.2], [700, 8, 1.7], [300, 21, 0.9], [120, 57, 2.5], [40, 173, 0.4], [12, 601, 1.2], [4, 1999, 0]],
  colLand: '#8a5a44', colSoil: '#4e3326', colMap: '#a0624a', desc: 'A scorched, airless rock close to Helion.' });
const HOME = makeBody({ id: 'verdan', name: 'Verdan', parent: SUN, orbitR: 1.4e10, phase0: 0.3, R: 500000, mu: 9.81 * 500000 * 500000,
  atmo: { top: 70000, rho0: 1.2, H: 5600 }, ocean: true, pad: true, hOff: 150,
  terrain: [[380, 3, 0.4], [240, 7, 1.3], [130, 17, 2.1], [55, 41, 0.7], [22, 113, 1.9], [7, 457, 0.3], [2.5, 1601, 0]],
  sky: ['#3f84dc', '#a8d4ff'], colLand: '#4f8f3a', colSoil: '#5a4632', colWater: '#2a66ad', colMap: '#3d78c0',
  desc: 'Home. Oceans, hills and a thick blue sky.' });
const MOON = makeBody({ id: 'pallid', name: 'Pallid', parent: HOME, orbitR: 9.0e6, phase0: 2.4, R: 150000, mu: 1.62 * 150000 * 150000,
  terrain: [[900, 2, 1], [520, 5, 0.3], [260, 13, 2], [110, 37, 0.5], [45, 97, 1.1], [14, 331, 0.5], [4, 1201, 2.2]],
  colLand: '#b4b4b9', colSoil: '#77777d', colMap: '#b0b0b6', desc: 'Verdan\'s grey moon. No air.' });
const OCHRE = makeBody({ id: 'ochre', name: 'Ochre', parent: SUN, orbitR: 2.1e10, phase0: 1.2, R: 320000, mu: 3.0 * 3.2e5 * 3.2e5,
  atmo: { top: 42000, rho0: 0.15, H: 5000 },
  terrain: [[1800, 2, 2.2], [900, 5, 0.6], [420, 14, 1.9], [160, 39, 0.2], [60, 101, 2.8], [18, 377, 1.4], [5, 1303, 0.7]],
  sky: ['#b86a4a', '#e8b48a'], colLand: '#c9743a', colSoil: '#7d4524', colMap: '#d07a3e', desc: 'A dusty red desert world with thin air.' });
const PIP = makeBody({ id: 'pip', name: 'Pip', parent: OCHRE, orbitR: 1.5e6, phase0: 0.7, R: 25000, mu: 0.2 * 2.5e4 * 2.5e4,
  terrain: [[900, 3, 0.5], [400, 7, 2.0], [150, 19, 1.1], [50, 53, 0.3], [12, 211, 2.4]],
  colLand: '#8c8070', colSoil: '#5b5248', colMap: '#9a8d7c', desc: 'A lumpy little moon of Ochre.' });
const SHARD = makeBody({ id: 'shard', name: 'Shard', parent: OCHRE, orbitR: 3.5e6, phase0: 3.6, R: 40000, mu: 0.3 * 4e4 * 4e4,
  terrain: [[1500, 2, 1.5], [600, 6, 0.1], [250, 15, 2.2], [80, 47, 1.0], [20, 157, 0.6]],
  colLand: '#7f7a86', colSoil: '#4c4852', colMap: '#8f8a96', desc: 'Ochre\'s outer moon, a jagged chunk of rock.' });
const TEMPEST = makeBody({ id: 'tempest', name: 'Tempest', parent: SUN, orbitR: 6.0e10, phase0: 5.1, R: 6.0e6, mu: 8 * 6e6 * 6e6, gas: true,
  atmo: { top: 300000, rho0: 1.5, H: 30000 }, sky: ['#7a5a3a', '#d8b27a'],
  colLand: '#e2c79c', colSoil: '#b08a5a', colMap: '#d9b47e', desc: 'A banded gas giant. There is no surface: go too deep and you are crushed.' });
const GALE = makeBody({ id: 'gale', name: 'Gale', parent: TEMPEST, orbitR: 3.0e7, phase0: 0.9, R: 400000, mu: 6 * 4e5 * 4e5,
  atmo: { top: 55000, rho0: 0.9, H: 6000 }, ocean: true, hOff: 80,
  terrain: [[500, 3, 1.1], [300, 8, 2.3], [140, 19, 0.4], [60, 47, 1.6], [20, 131, 2.9], [6, 503, 0.8]],
  sky: ['#2f8a8a', '#9ad8c8'], colLand: '#3f8f7a', colSoil: '#3d4a3a', colWater: '#1f6f7a', colMap: '#4a9a8a',
  desc: 'Tempest\'s largest moon, with air and teal seas.' });
const EMBER = makeBody({ id: 'ember', name: 'Ember', parent: TEMPEST, orbitR: 5.5e7, phase0: 2.2, R: 120000, mu: 1.2 * 1.2e5 * 1.2e5,
  terrain: [[1100, 3, 2.0], [500, 9, 0.8], [220, 23, 1.7], [90, 61, 0.2], [25, 199, 2.6], [8, 701, 1.0]],
  colLand: '#5a2a1e', colSoil: '#2e1712', colMap: '#c0442a', desc: 'A volcanic moon of black rock and red glow.' });
const FROST = makeBody({ id: 'frost', name: 'Frost', parent: TEMPEST, orbitR: 1.0e8, phase0: 4.4, R: 200000, mu: 1.8 * 2e5 * 2e5,
  terrain: [[600, 2, 0.6], [300, 6, 1.9], [120, 17, 2.7], [50, 43, 1.2], [15, 149, 0.3], [5, 557, 2.0]],
  colLand: '#dfe9f2', colSoil: '#9fb2c4', colMap: '#e3eef7', desc: 'An icy outer moon of Tempest.' });
const GLACIS = makeBody({ id: 'glacis', name: 'Glacis', parent: SUN, orbitR: 1.0e11, phase0: 2.7, R: 350000, mu: 4 * 3.5e5 * 3.5e5,
  atmo: { top: 30000, rho0: 0.25, H: 5000 },
  terrain: [[700, 2, 2.9], [350, 7, 1.4], [160, 18, 0.5], [60, 49, 2.2], [20, 163, 1.6], [6, 619, 0.2]],
  sky: ['#6f9ac0', '#d4ecfa'], colLand: '#cfe6f5', colSoil: '#8fb3cf', colMap: '#bfe3f7', desc: 'A frozen ocean world far from Helion.' });
const UMBRA = makeBody({ id: 'umbra', name: 'Umbra', parent: SUN, orbitR: 1.6e11, phase0: 0.1, R: 120000, mu: 0.6 * 1.2e5 * 1.2e5,
  terrain: [[1600, 2, 0.4], [700, 5, 2.4], [300, 13, 1.3], [100, 37, 0.6], [30, 121, 2.0], [9, 433, 1.5]],
  colLand: '#4a3d5c', colSoil: '#2a2236', colMap: '#6a5a84', desc: 'A dark dwarf world at the edge of the system.' });

const BODIES = [SUN, CINDER, HOME, MOON, OCHRE, PIP, SHARD, TEMPEST, GALE, EMBER, FROST, GLACIS, UMBRA];
SUN.soi = Infinity;
for (const b of BODIES) {
  if (!b.parent) continue;
  b.parent.children.push(b);
  b.n = Math.sqrt(b.parent.mu / Math.pow(b.orbitR, 3));
  b.soi = b.orbitR * Math.pow(b.mu / b.parent.mu, 0.4);
}
const BODY_BY_ID = Object.fromEntries(BODIES.map((b) => [b.id, b]));
const HOME_CHAIN = new Set([HOME, SUN]);
const PAD_PHI = Math.PI / 2;

/* Position, velocity and acceleration of `b` relative to the world origin (Verdan), as
   [x, y, vx, vy, ax, ay]. Offsets are summed only up to the nearest ancestor shared with Verdan,
   so nearby bodies keep full precision. Cached per body for the last time asked. */
function bodyState(b, t) {
  if (b === HOME) return [0, 0, 0, 0, 0, 0];
  if (b._t === t) return b._s;
  let anc = b;
  while (!HOME_CHAIN.has(anc)) anc = anc.parent;
  const s = [0, 0, 0, 0, 0, 0];
  const add = (x, sign) => {
    for (; x !== anc; x = x.parent) {
      const a = x.phase0 + x.n * t, c = Math.cos(a), sn = Math.sin(a), r = x.orbitR, n = x.n;
      s[0] += sign * r * c; s[1] += sign * r * sn;
      s[2] -= sign * r * n * sn; s[3] += sign * r * n * c;
      s[4] -= sign * n * n * r * c; s[5] -= sign * n * n * r * sn;
    }
  };
  add(b, 1);
  add(HOME, -1);
  b._t = t;
  b._s = s;
  return s;
}
function inHomeSystem(b) { for (let x = b; x; x = x.parent) if (x === HOME) return true; return false; }
function bodyPos(b, t) { const s = bodyState(b, t); return [s[0], s[1]]; }
function bodyVel(b, t) { const s = bodyState(b, t); return [s[2], s[3]]; }

/* Deepest sphere of influence containing the point. */
function soiBody(x, y, t) {
  let b = SUN;
  outer: for (;;) {
    for (const c of b.children) {
      const s = bodyState(c, t);
      if (Math.hypot(x - s[0], y - s[1]) < c.soi) { b = c; continue outer; }
    }
    return b;
  }
}

/* Gravity from the body whose sphere of influence we are in (patched conics), plus that body's own
   acceleration in the world frame, so motion relative to it is exactly Keplerian. */
function gravAcc(b, x, y, t) {
  const s = bodyState(b, t);
  const dx = x - s[0], dy = y - s[1];
  const r2 = dx * dx + dy * dy, r = Math.sqrt(r2);
  const k = -b.mu / (r2 * r);
  return [dx * k + s[4], dy * k + s[5]];
}

function terrainH(b, phi) {
  let h = b.hOff;
  for (const [a, f, p] of b.terrain) h += a * Math.sin(f * phi + p);
  if (b.pad) {
    const k = smoothstep(0.0004, 0.006, Math.abs(wrapPi(phi - PAD_PHI)));
    h = h * k + 4 * (1 - k);
  }
  return h;
}
function groundAlt(b, phi) { const h = terrainH(b, phi); return b.ocean ? Math.max(h, 0) : h; }

/* Lowest altitude for time warp level `idx` (rails warp only), scaled by the body's size. */
const WARP_ALT = [0, 0, 0, 0, 0, 2000, 5000, 15000, 40000, 100000, 300000];
function warpBase(b) { return b.star ? b.R * 0.5 : b.atmo ? b.atmo.top : Math.max(3000, b.R * 0.03); }
function warpMinAlt(b, idx) { return idx <= 3 ? -Infinity : warpBase(b) + WARP_ALT[idx] * Math.max(0.1, b.R / HOME.R); }

/* Largest safe integration step: a fraction of the local orbit, and short enough not to jump
   over a sphere-of-influence boundary. */
function stepLimit(b, x, y, vx, vy, t, frac, cap) {
  const s = bodyState(b, t);
  const rx = x - s[0], ry = y - s[1], r = Math.hypot(rx, ry);
  let dt = frac * TAU * Math.sqrt((r * r * r) / b.mu);
  const v = Math.hypot(vx - s[2], vy - s[3]) + 1;
  for (const c of b.children) {
    const p = bodyState(c, t);
    const d = Math.hypot(x - p[0], y - p[1]) - c.soi;
    dt = Math.min(dt, Math.max(20, (0.3 * d) / (v + c.orbitR * c.n)));
  }
  if (b.parent) dt = Math.min(dt, Math.max(20, (0.3 * (b.soi - r)) / v));
  return clamp(dt, 0.05, cap);
}

function atmo(b, alt) {
  if (!b.atmo || alt >= b.atmo.top) return { rho: 0, p: 0 };
  const f = Math.exp(-Math.max(alt, -2000) / b.atmo.H);
  const fade = alt > b.atmo.top * 0.8 ? (b.atmo.top - alt) / (b.atmo.top * 0.2) : 1;
  return { rho: b.atmo.rho0 * f * fade, p: f * fade };
}

/* ---------- orbital mechanics ---------- */
function orbitElements(b, x, y, vx, vy, t) {
  const bp = bodyPos(b, t), bv = bodyVel(b, t);
  const rx = x - bp[0], ry = y - bp[1], wx = vx - bv[0], wy = vy - bv[1];
  const r = Math.hypot(rx, ry), v2 = wx * wx + wy * wy, mu = b.mu;
  const h = rx * wy - ry * wx;
  const rv = rx * wx + ry * wy;
  const ex = ((v2 - mu / r) * rx - rv * wx) / mu, ey = ((v2 - mu / r) * ry - rv * wy) / mu;
  const e = Math.hypot(ex, ey);
  const energy = v2 / 2 - mu / r;
  const a = Math.abs(energy) < 1e-12 ? Infinity : -mu / (2 * energy);
  const p = (h * h) / mu;
  const rp = p / (1 + e);
  const ra = a > 0 && isFinite(a) ? 2 * a - rp : Infinity;
  const o = { b, a, e, ex, ey, rp, ra, h, period: Infinity, tAp: NaN, tPe: NaN, r, v: Math.sqrt(v2) };
  let nu = Math.atan2(ry, rx) - Math.atan2(ey, ex);
  if (h < 0) nu = -nu;
  nu = wrapPi(nu);
  if (e < 1) {
    o.period = TAU * Math.sqrt((a * a * a) / mu);
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
    let M = E - e * Math.sin(E);
    if (M < 0) M += TAU;
    const n = TAU / o.period;
    o.tPe = (TAU - M) / n;
    o.tAp = (M < Math.PI ? Math.PI - M : 3 * Math.PI - M) / n;
  } else if (e > 1) {
    const Fh = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
    const M = e * Math.sinh(Fh) - Fh;
    const n = Math.sqrt(mu / Math.pow(-a, 3));
    o.tPe = M < 0 ? -M / n : NaN;
  }
  return o;
}

function rk4Step(b, s, t, dt) {
  const h2 = dt / 2;
  const a1 = gravAcc(b, s[0], s[1], t);
  const x2 = s[0] + s[2] * h2, y2 = s[1] + s[3] * h2, vx2 = s[2] + a1[0] * h2, vy2 = s[3] + a1[1] * h2;
  const a2 = gravAcc(b, x2, y2, t + h2);
  const x3 = s[0] + vx2 * h2, y3 = s[1] + vy2 * h2, vx3 = s[2] + a2[0] * h2, vy3 = s[3] + a2[1] * h2;
  const a3 = gravAcc(b, x3, y3, t + h2);
  const x4 = s[0] + vx3 * dt, y4 = s[1] + vy3 * dt, vx4 = s[2] + a3[0] * dt, vy4 = s[3] + a3[1] * dt;
  const a4 = gravAcc(b, x4, y4, t + dt);
  s[0] += (dt / 6) * (s[2] + 2 * vx2 + 2 * vx3 + vx4);
  s[1] += (dt / 6) * (s[3] + 2 * vy2 + 2 * vy3 + vy4);
  s[2] += (dt / 6) * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]);
  s[3] += (dt / 6) * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1]);
}

/* Integrate the future coasting path (no thrust, no drag) through SOI changes. */
function predictPath(x, y, vx, vy, t0) {
  const s = [x, y, vx, vy];
  let t = t0, b = soiBody(x, y, t);
  const pts = [{ x, y, t, b }];
  const events = [];
  let bp = bodyPos(b, t);
  let lastAng = Math.atan2(y - bp[1], x - bp[0]);
  let swept = 0, switches = 0;
  for (let i = 0; i < 6000; i++) {
    const dt = stepLimit(b, s[0], s[1], s[2], s[3], t, 0.004, 2e6);
    rk4Step(b, s, t, dt);
    t += dt;
    const nb = soiBody(s[0], s[1], t);
    if (nb !== b) {
      events.push({ type: 'soi', from: b, to: nb, t, idx: pts.length });
      b = nb; switches++; swept = 0;
      bp = bodyPos(b, t);
      lastAng = Math.atan2(s[1] - bp[1], s[0] - bp[0]);
      pts.push({ x: s[0], y: s[1], t, b });
      if (switches >= 4) break;
      continue;
    }
    bp = bodyPos(b, t);
    const dx = s[0] - bp[0], dy = s[1] - bp[1], rr = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    swept += Math.abs(wrapPi(ang - lastAng));
    lastAng = ang;
    pts.push({ x: s[0], y: s[1], t, b });
    if (rr < b.R + groundAlt(b, ang)) { events.push({ type: 'impact', b, t, idx: pts.length - 1 }); break; }
    if (swept > TAU + 0.01) break;
    if (t - t0 > 3e8) break;
  }
  return { pts, events };
}
