'use strict';
/* Rocketwright — navigation: manoeuvre nodes, targets, transfer windows and the Δv map. */

/* Coast from (x, y, vx, vy) at t0 to t1 under gravity alone. */
function propagate(x, y, vx, vy, t0, t1) {
  const s = [x, y, vx, vy];
  let t = t0, b = soiBody(x, y, t);
  for (let i = 0; i < 40000 && t < t1 - 1e-6; i++) {
    const dt = Math.min(t1 - t, stepLimit(b, s[0], s[1], s[2], s[3], t, 0.004, 2e6));
    rk4Step(b, s, t, dt);
    t += dt;
    b = soiBody(s[0], s[1], t);
  }
  return { s, b, t };
}

/* Prograde and radial-out unit vectors (world) for a state relative to body b. */
function orbitFrame(b, s, t) {
  const st = bodyState(b, t);
  const vx = s[2] - st[2], vy = s[3] - st[3], v = Math.hypot(vx, vy) || 1;
  const rx = s[0] - st[0], ry = s[1] - st[1], r = Math.hypot(rx, ry) || 1;
  return { pro: [vx / v, vy / v], rad: [rx / r, ry / r] };
}

/* ---------------- manoeuvre nodes ----------------
   A node is { t, pro, rad } (Δv in m/s along prograde and radial-out at time t). While you burn,
   `applied` collects the Δv you've actually added; once it passes 0.5 m/s the burn direction is
   frozen and `remaining` counts down. */

function makeNode(t) { return { t, pro: 0, rad: 0, applied: [0, 0], frozen: false, remaining: [0, 0], dvVec: [0, 0] }; }

function nodeTouched(n) { n.frozen = false; n.applied = [0, 0]; }

/* Recompute where the node is, its burn vector, and the path after it. */
function updateNode(n, c, t) {
  if (n.frozen) {
    n.remaining = [n.dvVec[0] - n.applied[0], n.dvVec[1] - n.applied[1]];
    n.pred = predictPath(c.pos[0], c.pos[1], c.vel[0] + n.remaining[0], c.vel[1] + n.remaining[1], t);
    return;
  }
  const p = propagate(c.pos[0], c.pos[1], c.vel[0], c.vel[1], t, Math.max(t, n.t));
  const f = orbitFrame(p.b, p.s, p.t);
  n.body = p.b;
  n.pos = [p.s[0], p.s[1]];
  n.frame = f;
  n.dvVec = [f.pro[0] * n.pro + f.rad[0] * n.rad, f.pro[1] * n.pro + f.rad[1] * n.rad];
  n.remaining = n.dvVec.slice();
  n.pred = predictPath(p.s[0], p.s[1], p.s[2] + n.dvVec[0], p.s[3] + n.dvVec[1], p.t);
}

/* Burn time for dv with the engines that are lit (or that the next stage lights). */
function burnTime(c, dv) {
  let engs = c.engines.filter((e) => e.ignited && c.engineHasFuel(e));
  if (!engs.length && c.stageIdx < c.stages.length) engs = c.engines.filter((e) => c.stages[c.stageIdx].includes(e.uid));
  let T = 0, flow = 0;
  for (const e of engs) { T += e.def.thrust; flow += e.def.thrust / (e.def.ispVac * G0); }
  if (T <= 0) return Infinity;
  const ve = T / flow;
  return ((c.M * ve) / T) * (1 - Math.exp(-dv / ve));
}

/* Count the Δv thrust adds while a node exists. Returns true when the node is done. */
function nodeApply(n, ax, ay, dt) {
  n.applied[0] += ax * dt;
  n.applied[1] += ay * dt;
  if (!n.frozen && Math.hypot(n.applied[0], n.applied[1]) > 0.5) n.frozen = true;
  if (!n.frozen) return false;
  n.remaining = [n.dvVec[0] - n.applied[0], n.dvVec[1] - n.applied[1]];
  const left = Math.hypot(n.remaining[0], n.remaining[1]);
  return left < 0.3 || n.remaining[0] * n.dvVec[0] + n.remaining[1] * n.dvVec[1] < 0;
}

/* ---------------- targets ---------------- */

/* Closest approach to body `target` along a predicted path. */
function closestApproach(pred, target) {
  if (!pred || !target) return null;
  let best = null;
  for (let i = 0; i < pred.pts.length; i++) {
    const p = pred.pts[i], tp = bodyPos(target, p.t);
    const d = Math.hypot(p.x - tp[0], p.y - tp[1]);
    if (!best || d < best.d) best = { d, t: p.t, i, inside: p.b === target };
  }
  return best;
}

/* Phase angle to the target around their common parent, the ideal angle for a Hohmann transfer,
   and how long until that window. */
function transferWindow(c, target, t) {
  const P = target.parent;
  if (!P) return null;
  let sb = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], t);
  let refPos, w1;
  const pp = bodyPos(P, t);
  if (sb === P) {
    refPos = c.pos;
    const o = orbitElements(P, c.pos[0], c.pos[1], c.vel[0], c.vel[1], t);
    w1 = isFinite(o.period) ? (TAU / o.period) * Math.sign(o.h) : null;
  } else {
    while (sb && sb.parent !== P) sb = sb.parent;
    if (!sb || sb === target) return null;
    refPos = bodyPos(sb, t);
    w1 = sb.n;
  }
  if (w1 === null) return null;
  const tp = bodyPos(target, t);
  const r1 = Math.hypot(refPos[0] - pp[0], refPos[1] - pp[1]), r2 = target.orbitR;
  const a1 = Math.atan2(refPos[1] - pp[1], refPos[0] - pp[0]), a2 = Math.atan2(tp[1] - pp[1], tp[0] - pp[0]);
  const wrap2 = (a) => ((a % TAU) + TAU) % TAU;
  const phase = wrap2(a2 - a1);
  const ideal = wrap2(Math.PI * (1 - Math.pow((r1 + r2) / (2 * r2), 1.5)));
  const rate = target.n - w1;
  const wait = Math.abs(rate) < 1e-12 ? Infinity : rate < 0 ? wrap2(phase - ideal) / -rate : wrap2(ideal - phase) / rate;
  return { phase, ideal, wait, r1, r2, via: sb === P ? null : sb };
}

/* ---------------- Δv map ---------------- */

function lowOrbitR(b) { return b.R + (b.atmo ? b.atmo.top : 0) + Math.max(10000, b.R * 0.02); }
function vCirc(mu, r) { return Math.sqrt(mu / r); }
/* Burn from a low circular orbit to leave (or, reversed, to be captured) with hyperbolic excess vInf. */
function escapeBurn(b, vInf) { const r = lowOrbitR(b); return Math.sqrt(vInf * vInf + (2 * b.mu) / r) - vCirc(b.mu, r); }
function hohmann(mu, r1, r2) {
  const a = (r1 + r2) / 2;
  const v1 = vCirc(mu, r1), v2 = vCirc(mu, r2);
  const vp = Math.sqrt(mu * (2 / r1 - 1 / a)), va = Math.sqrt(mu * (2 / r2 - 1 / a));
  return { dep: Math.abs(vp - v1), arr: Math.abs(v2 - va), time: Math.PI * Math.sqrt((a * a * a) / mu) };
}
/* Climb from the surface to low orbit, with a rough allowance for gravity and drag losses. */
function launchDv(b) {
  if (b.gas || b.star) return null;
  const f = 1.1 + (b.atmo ? Math.min(0.5, b.atmo.rho0 * 0.42) : 0);
  return vCirc(b.mu, lowOrbitR(b)) * f;
}

/* Rows for every world: transfer from low Verdan orbit, capture into low orbit, launch/landing, trip time. */
function dvMapRows() {
  const rows = [];
  for (const b of BODIES) {
    if (b.star || b === HOME) continue;
    let transfer, capture, time;
    if (b.parent === HOME) {
      const h = hohmann(HOME.mu, lowOrbitR(HOME), b.orbitR);
      transfer = h.dep;
      capture = escapeBurn(b, h.arr);
      time = h.time;
    } else {
      const planet = b.parent === SUN ? b : b.parent;
      const h = hohmann(SUN.mu, HOME.orbitR, planet.orbitR);
      transfer = escapeBurn(HOME, h.dep);
      time = h.time;
      if (planet === b) capture = escapeBurn(b, h.arr);
      else {
        // capture around the planet at the moon's distance, then drop into a low moon orbit
        const rm = b.orbitR;
        capture = Math.sqrt(h.arr * h.arr + (2 * planet.mu) / rm) - vCirc(planet.mu, rm) + escapeBurn(b, 0);
      }
    }
    const land = launchDv(b);
    rows.push({ b, transfer, capture, land, time, aero: !!b.atmo });
  }
  return rows;
}
