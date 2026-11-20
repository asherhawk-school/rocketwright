'use strict';
/* Rocketwright — drawing helpers shared by the hangar and flight views.
   All part drawing happens in "local" metres: x lateral, y up along the stack, nose at y = 0. */

function cylGrad(ctx, x0, x1, c0, c1, c2) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, c0); g.addColorStop(0.42, c1); g.addColorStop(1, c2);
  return g;
}
function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function drawPart(ctx, p, lw, footY) {
  const d = p.def, top = p.top, bot = p.bot, h = d.h;
  ctx.lineWidth = lw;
  ctx.strokeStyle = 'rgba(12,15,22,0.9)';
  ctx.lineJoin = 'round';
  switch (d.kind) {
    case 'pod': {
      ctx.fillStyle = cylGrad(ctx, -1, 1, '#8a9099', '#f2f4f7', '#727882');
      poly(ctx, [[-1, bot + 0.12], [1, bot + 0.12], [0.42, top], [-0.42, top]]); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#6b4a2e';
      poly(ctx, [[-1.02, bot], [1.02, bot], [1.0, bot + 0.14], [-1.0, bot + 0.14]]); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1d3a5c';
      poly(ctx, [[-0.32, bot + 0.62], [0.32, bot + 0.62], [0.24, bot + 1.0], [-0.24, bot + 1.0]]); ctx.fill();
      ctx.fillStyle = 'rgba(160,215,255,0.55)';
      poly(ctx, [[-0.26, bot + 0.66], [-0.06, bot + 0.66], [-0.12, bot + 0.95], [-0.2, bot + 0.95]]); ctx.fill();
      ctx.fillStyle = '#c94a2c'; ctx.fillRect(-0.42, top - 0.08, 0.84, 0.08);
      break;
    }
    case 'chute': {
      ctx.fillStyle = cylGrad(ctx, -0.5, 0.5, '#9c3a1f', '#f06a3c', '#8a321a');
      poly(ctx, [[-0.42, bot], [0.42, bot], [0.3, top], [-0.3, top]]); ctx.fill(); ctx.stroke();
      break;
    }
    case 'wheel': {
      ctx.fillStyle = cylGrad(ctx, -1, 1, '#3a3f47', '#7b838f', '#30343b');
      ctx.fillRect(-1, bot, 2, h); ctx.strokeRect(-1, bot, 2, h);
      ctx.fillStyle = '#e0b030'; ctx.fillRect(-1, bot + h * 0.4, 2, h * 0.2);
      break;
    }
    case 'tank': {
      ctx.fillStyle = cylGrad(ctx, -1, 1, '#9aa0a8', '#f4f5f7', '#858b94');
      ctx.fillRect(-1, bot, 2, h); ctx.strokeRect(-1, bot, 2, h);
      ctx.fillStyle = '#3b414b';
      ctx.fillRect(-1, top - 0.1, 2, 0.1); ctx.fillRect(-1, bot, 2, 0.1);
      if (h > 1.5) {
        ctx.fillStyle = '#2b2f36';
        const n = Math.round(h / 1.8);
        for (let i = 1; i <= n; i++) { const y = bot + (h * i) / (n + 1); ctx.fillRect(-1, y - 0.06, 2, 0.12); }
      }
      // fuel gauge
      const frac = d.fuel ? p.fuel / d.fuel : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0.62, bot + 0.18, 0.14, h - 0.36);
      ctx.fillStyle = '#f0a030'; ctx.fillRect(0.62, bot + 0.18, 0.14, (h - 0.36) * frac);
      break;
    }
    case 'decoupler': {
      ctx.fillStyle = '#2a2e35'; ctx.fillRect(-1.04, bot, 2.08, h); ctx.strokeRect(-1.04, bot, 2.08, h);
      ctx.fillStyle = '#e8b923'; ctx.fillRect(-1.04, bot + h * 0.38, 2.08, h * 0.24);
      break;
    }
    case 'legs': {
      const fy = footY !== undefined ? footY : bot - 0.9;
      ctx.strokeStyle = '#59606b'; ctx.lineWidth = 0.14; ctx.lineCap = 'round';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 0.95, top - 0.1); ctx.lineTo(s * 2.3, fy + 0.1);
        ctx.moveTo(s * 0.95, bot + 0.05); ctx.lineTo(s * 1.75, lerp(bot, fy, 0.55));
        ctx.stroke();
      }
      ctx.fillStyle = '#3a3f47';
      for (const s of [-1, 1]) ctx.fillRect(s * 2.3 - 0.35, fy, 0.7, 0.12);
      ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(12,15,22,0.9)';
      ctx.fillStyle = cylGrad(ctx, -1, 1, '#4a505a', '#9aa2ad', '#40454d');
      ctx.fillRect(-1, bot, 2, h); ctx.strokeRect(-1, bot, 2, h);
      break;
    }
    case 'fins': {
      ctx.fillStyle = '#c23b2a';
      for (const s of [-1, 1]) {
        poly(ctx, [[s * 1, top + 0.6], [s * 1.85, bot - 0.5], [s * 1.85, bot - 1.1], [s * 1, bot - 0.7]]);
        ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = cylGrad(ctx, -1, 1, '#4a505a', '#9aa2ad', '#40454d');
      ctx.fillRect(-1, bot, 2, h); ctx.strokeRect(-1, bot, 2, h);
      break;
    }
    case 'engine': {
      const mh = h * 0.3, bw = d.bell / 2;
      ctx.fillStyle = '#3a3f48';
      poly(ctx, [[-1, top], [1, top], [0.55, top - mh], [-0.55, top - mh]]); ctx.fill(); ctx.stroke();
      ctx.fillStyle = cylGrad(ctx, -bw, bw, '#2a2d33', '#9aa0aa', '#24272c');
      const yb = top - mh;
      ctx.beginPath();
      ctx.moveTo(-0.38, yb); ctx.lineTo(0.38, yb);
      ctx.quadraticCurveTo(0.42, lerp(yb, bot, 0.65), bw, bot);
      ctx.lineTo(-bw, bot);
      ctx.quadraticCurveTo(-0.42, lerp(yb, bot, 0.65), -0.38, yb);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5b616b'; ctx.fillRect(-bw, bot, 2 * bw, 0.07);
      break;
    }
    case 'srb': {
      const nz = 0.55;
      ctx.fillStyle = cylGrad(ctx, -0.92, 0.92, '#a7abb2', '#fbfbfb', '#8f949c');
      ctx.fillRect(-0.92, bot + nz, 1.84, h - nz); ctx.strokeRect(-0.92, bot + nz, 1.84, h - nz);
      ctx.fillStyle = '#c8402f';
      for (const f of [0.18, 0.55]) ctx.fillRect(-0.92, bot + nz + (h - nz) * f, 1.84, 0.3);
      ctx.fillStyle = '#3b414b'; ctx.fillRect(-0.92, top - 0.12, 1.84, 0.12);
      ctx.fillStyle = '#2f3238';
      poly(ctx, [[-0.35, bot + nz], [0.35, bot + nz], [0.62, bot], [-0.62, bot]]); ctx.fill(); ctx.stroke();
      break;
    }
  }
}

function drawFlame(ctx, p, pressure, flick) {
  const d = p.def;
  const bw = d.kind === 'srb' ? 0.62 : d.bell / 2;
  const vac = 1 - clamp(pressure, 0, 1);
  const L = (2.5 + 6 * p.burn) * (1 + 1.6 * vac) * Math.pow(d.thrust / 150, 0.35) * flick;
  const w1 = bw * (0.6 + 2.2 * vac);
  const y0 = p.bot;
  const g = ctx.createLinearGradient(0, y0, 0, y0 - L);
  if (d.kind === 'srb') {
    g.addColorStop(0, 'rgba(255,245,210,0.95)'); g.addColorStop(0.3, 'rgba(255,160,50,0.8)'); g.addColorStop(1, 'rgba(255,60,0,0)');
  } else {
    g.addColorStop(0, 'rgba(235,242,255,0.95)'); g.addColorStop(0.25, 'rgba(255,205,130,0.8)'); g.addColorStop(1, 'rgba(255,90,30,0)');
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-bw * 0.85, y0); ctx.lineTo(bw * 0.85, y0);
  ctx.quadraticCurveTo(w1, y0 - L * 0.4, 0, y0 - L);
  ctx.quadraticCurveTo(-w1, y0 - L * 0.4, -bw * 0.85, y0);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.moveTo(-bw * 0.4, y0); ctx.lineTo(bw * 0.4, y0); ctx.lineTo(0, y0 - L * 0.35);
  ctx.fill();
}

function drawCanopy(ctx, c) {
  const cp = c.parts.find((p) => p.def.chute);
  if (!cp) return;
  const y0 = cp.top;
  const s = Math.sqrt(c.chuteArea) * 0.6;
  const L = s * 1.1 + 2;
  ctx.strokeStyle = 'rgba(235,235,235,0.85)';
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  for (const f of [-1, -0.5, 0.5, 1]) { ctx.moveTo(0, y0); ctx.lineTo(f * s, y0 + L); }
  ctx.stroke();
  ctx.fillStyle = '#e8643a';
  ctx.beginPath();
  ctx.moveTo(-s, y0 + L);
  ctx.quadraticCurveTo(-s * 0.95, y0 + L + s * 0.9, 0, y0 + L + s * 0.85);
  ctx.quadraticCurveTo(s * 0.95, y0 + L + s * 0.9, s, y0 + L);
  ctx.quadraticCurveTo(0, y0 + L + s * 0.25, -s, y0 + L);
  ctx.fill();
  ctx.fillStyle = '#f4efe6';
  ctx.beginPath();
  ctx.moveTo(-s * 0.33, y0 + L + s * 0.13);
  ctx.quadraticCurveTo(-s * 0.3, y0 + L + s * 0.8, 0, y0 + L + s * 0.85);
  ctx.quadraticCurveTo(s * 0.3, y0 + L + s * 0.8, s * 0.33, y0 + L + s * 0.13);
  ctx.quadraticCurveTo(0, y0 + L + s * 0.22, -s * 0.33, y0 + L + s * 0.13);
  ctx.fill();
}

/* Draw a craft in world space; ctx is already in world-metre coordinates centred on `cam`. */
function drawCraft(ctx, c, cam, zoom, pressure) {
  ctx.save();
  ctx.translate(c.pos[0] - cam[0], c.pos[1] - cam[1]);
  ctx.rotate(c.angle - Math.PI / 2);
  ctx.translate(0, -c.yc);
  if (c.chuteArea > 1 && c.hasChute) drawCanopy(ctx, c);
  ctx.globalCompositeOperation = 'lighter';
  const flick = 0.9 + Math.random() * 0.2;
  for (const p of c.parts) if (p.burn > 0) drawFlame(ctx, p, pressure, flick);
  ctx.globalCompositeOperation = 'source-over';
  const lw = Math.max(0.03, 1 / zoom);
  for (const p of c.parts) drawPart(ctx, p, lw, p.def.legs ? c.footY : undefined);
  ctx.restore();
}

/* Small icon of a single part for the parts palette. */
function drawPartIcon(canvas, id) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = 46, H = 54;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  const def = PART_DEFS[id];
  const p = { def, top: 0, bot: -def.h, fuel: def.fuel || 0, solid: def.solid || 0 };
  let extentX = 1.1, yTop = 0, yBot = -def.h;
  if (def.kind === 'fins') { extentX = 1.95; yTop = 0.6; yBot = -def.h - 1.1; }
  if (def.kind === 'legs') { extentX = 2.7; yBot = -def.h - 0.9; }
  const s = Math.min((W - 6) / (2 * extentX), (H - 6) / (yTop - yBot));
  ctx.setTransform(dpr * s, 0, 0, -dpr * s, (dpr * W) / 2, dpr * (H / 2 + ((yTop + yBot) / 2) * s));
  drawPart(ctx, p, 1 / s, -def.h - 0.9);
}

/* Terrain of a body in world space, sampled only across the part of the surface in view. */
function drawBodyWorld(ctx, b, t, cam, viewR, zoom) {
  const bp = bodyPos(b, t);
  const cx = bp[0] - cam[0], cy = bp[1] - cam[1];
  const d = Math.hypot(cx, cy);
  if (d - b.R - 2500 > viewR) return;
  const camAng = Math.atan2(-cy, -cx);
  let full = b.R * zoom < 4000;
  let half = Math.PI;
  if (!full) {
    const c = (b.R * b.R + d * d - viewR * viewR) / (2 * b.R * d);
    half = Math.acos(clamp(c, -1, 1)) * 1.25 + 2500 / b.R + (0.2 * viewR) / b.R;
    if (half >= Math.PI) { half = Math.PI; full = true; }
  }
  const N = full ? 720 : 300;
  const xs = new Float64Array(N + 1), ys = new Float64Array(N + 1), hs = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const phi = camAng - half + (2 * half * i) / N;
    const h = terrainH(b, phi), r = b.R + h;
    hs[i] = h; xs[i] = cx + r * Math.cos(phi); ys[i] = cy + r * Math.sin(phi);
  }
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i <= N; i++) ctx.lineTo(xs[i], ys[i]);
  if (!full) {
    const rin = Math.max(0, b.R - Math.max(viewR * 2.5, 3000));
    for (let j = 0; j <= 24; j++) {
      const phi = camAng + half - (2 * half * j) / 24;
      ctx.lineTo(cx + rin * Math.cos(phi), cy + rin * Math.sin(phi));
    }
  }
  ctx.closePath();
  ctx.fillStyle = b.colSoil;
  ctx.fill();
  ctx.strokeStyle = b.colLand;
  ctx.lineWidth = Math.max(5 / zoom, 1.5);
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i <= N; i++) ctx.lineTo(xs[i], ys[i]);
  ctx.stroke();
  if (b.ocean) {
    ctx.fillStyle = b.colWater;
    let i = 0;
    while (i <= N) {
      if (hs[i] >= 0) { i++; continue; }
      const i0 = Math.max(0, i - 1);
      while (i <= N && hs[i] < 0) i++;
      const i1 = Math.min(N, i);
      ctx.beginPath();
      for (let k = i0; k <= i1; k++) {
        const phi = camAng - half + (2 * half * k) / N;
        const x = cx + b.R * Math.cos(phi), y = cy + b.R * Math.sin(phi);
        if (k === i0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (let k = i1; k >= i0; k--) ctx.lineTo(xs[k], ys[k]);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawPad(ctx, cam, viewR) {
  const base = HOME.R + terrainH(HOME, PAD_PHI);
  const ox = -cam[0], oy = base - cam[1];
  if (Math.hypot(ox, oy) > viewR + 200) return;
  ctx.fillStyle = '#6d7076'; ctx.fillRect(ox - 22, oy - 3, 44, 3);
  ctx.fillStyle = '#4c4f55'; ctx.fillRect(ox - 22, oy - 0.4, 44, 0.4);
  ctx.fillStyle = '#26272b'; ctx.fillRect(ox - 3, oy - 2.8, 6, 2.4);
  const tx = ox - 7.5, tw = 2.6, th = 34;
  ctx.strokeStyle = '#b5482f'; ctx.lineWidth = 0.25;
  ctx.strokeRect(tx, oy, tw, th);
  ctx.beginPath();
  for (let y = 0; y < th; y += 2.6) {
    ctx.moveTo(tx, oy + y); ctx.lineTo(tx + tw, oy + y + 2.6);
    ctx.moveTo(tx + tw, oy + y); ctx.lineTo(tx, oy + y + 2.6);
  }
  ctx.stroke();
  ctx.fillStyle = '#b5482f';
  ctx.fillRect(tx + tw, oy + th - 6, 3.4, 0.5);
  ctx.fillStyle = '#ff4030';
  ctx.beginPath(); ctx.arc(tx + tw / 2, oy + th + 0.4, 0.45, 0, TAU); ctx.fill();
}
