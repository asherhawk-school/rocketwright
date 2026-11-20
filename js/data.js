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
const CATEGORIES = ['Command', 'Fuel', 'Engines', 'Coupling', 'Structure', 'Utility'];

const MILESTONES = [
  { id: 'liftoff', name: 'Liftoff', desc: 'Leave the launch pad.' },
  { id: 'alt10k', name: 'Into the Blue', desc: 'Reach 10 km altitude.' },
  { id: 'space', name: 'Edge of Space', desc: 'Climb above 70 km, the top of Verdan\'s atmosphere.' },
  { id: 'orbit', name: 'Orbit!', desc: 'Reach a stable orbit around Verdan (periapsis above 70 km).' },
  { id: 'splash', name: 'Safe Return', desc: 'Land or splash down on Verdan after reaching space.' },
  { id: 'moonSoi', name: 'Pallid Encounter', desc: 'Enter Pallid\'s sphere of influence.' },
  { id: 'moonOrbit', name: 'Lunar Orbit', desc: 'Reach a stable orbit around Pallid.' },
  { id: 'moonLand', name: 'Footprints', desc: 'Land safely on Pallid.' },
  { id: 'roundTrip', name: 'Round Trip', desc: 'Land on Pallid, then come home safely to Verdan.' },
];

/* ---------- celestial bodies ---------- */
const HOME = {
  id: 'verdan', name: 'Verdan', R: 500000, mu: 9.81 * 500000 * 500000, atmo: { top: 70000, rho0: 1.2, H: 5600 },
  ocean: true, soi: Infinity, orbitR: 0,
  colLand: '#4f8f3a', colSoil: '#5a4632', colWater: '#2a66ad', colMap: '#3d78c0',
};
const MOON = {
  id: 'pallid', name: 'Pallid', R: 150000, mu: 1.62 * 150000 * 150000, atmo: null, ocean: false,
  orbitR: 9.0e6, phase0: 2.4,
  colLand: '#b4b4b9', colSoil: '#77777d', colMap: '#b0b0b6',
};
MOON.n = Math.sqrt(HOME.mu / Math.pow(MOON.orbitR, 3));
MOON.soi = MOON.orbitR * Math.pow(MOON.mu / HOME.mu, 0.4);
const BODIES = [HOME, MOON];
const PAD_PHI = Math.PI / 2;

function bodyPos(b, t) {
  if (!b.orbitR) return [0, 0];
  const a = b.phase0 + b.n * t;
  return [b.orbitR * Math.cos(a), b.orbitR * Math.sin(a)];
}
function bodyVel(b, t) {
  if (!b.orbitR) return [0, 0];
  const a = b.phase0 + b.n * t, s = b.orbitR * b.n;
  return [-s * Math.sin(a), s * Math.cos(a)];
}
function soiBody(x, y, t) {
  const m = bodyPos(MOON, t);
  return Math.hypot(x - m[0], y - m[1]) < MOON.soi ? MOON : HOME;
}
/* Gravity from the body whose sphere of influence we are in (patched conics).
   Inside the moon's SOI we add the moon's own acceleration so motion relative to it is Keplerian. */
function gravAcc(b, x, y, t) {
  const bp = bodyPos(b, t);
  const dx = x - bp[0], dy = y - bp[1];
  const r2 = dx * dx + dy * dy, r = Math.sqrt(r2);
  const k = -b.mu / (r2 * r);
  let ax = dx * k, ay = dy * k;
  if (b.orbitR) { const n2 = b.n * b.n; ax -= n2 * bp[0]; ay -= n2 * bp[1]; }
  return [ax, ay];
}

function terrainH(b, phi) {
  if (b === HOME) {
    const h = 380 * Math.sin(3 * phi + 0.4) + 240 * Math.sin(7 * phi + 1.3) + 130 * Math.sin(17 * phi + 2.1) +
      55 * Math.sin(41 * phi + 0.7) + 22 * Math.sin(113 * phi + 1.9) + 7 * Math.sin(457 * phi + 0.3) +
      2.5 * Math.sin(1601 * phi) + 150;
    const d = Math.abs(wrapPi(phi - PAD_PHI));
    const k = smoothstep(0.0004, 0.006, d);
    return h * k + 4 * (1 - k);
  }
  return 900 * Math.sin(2 * phi + 1) + 520 * Math.sin(5 * phi + 0.3) + 260 * Math.sin(13 * phi + 2) +
    110 * Math.sin(37 * phi + 0.5) + 45 * Math.sin(97 * phi + 1.1) + 14 * Math.sin(331 * phi + 0.5) +
    4 * Math.sin(1201 * phi + 2.2);
}
function groundAlt(b, phi) { const h = terrainH(b, phi); return b.ocean ? Math.max(h, 0) : h; }

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
  for (let i = 0; i < 5000; i++) {
    bp = bodyPos(b, t);
    const r = Math.hypot(s[0] - bp[0], s[1] - bp[1]);
    const dt = clamp(0.004 * TAU * Math.sqrt((r * r * r) / b.mu), 0.5, 600);
    rk4Step(b, s, t, dt);
    t += dt;
    const nb = soiBody(s[0], s[1], t);
    if (nb !== b) {
      events.push({ type: 'soi', from: b, to: nb, t, idx: pts.length });
      b = nb; switches++; swept = 0;
      bp = bodyPos(b, t);
      lastAng = Math.atan2(s[1] - bp[1], s[0] - bp[0]);
      pts.push({ x: s[0], y: s[1], t, b });
      if (switches >= 3) break;
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
    if (b === HOME && rr > MOON.orbitR * 2.5) { events.push({ type: 'escape', t }); break; }
    if (t - t0 > 8e6) break;
  }
  return { pts, events };
}
