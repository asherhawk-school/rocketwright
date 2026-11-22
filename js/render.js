'use strict';
/* Rocketwright — drawing helpers shared by the hangar and flight views.
   Parts are drawn in craft-local metres: x lateral, y up. Each part knows its own x, top, bot and
   whether it is mirrored (side parts on the left). */

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
const OUTLINE = 'rgba(12,15,22,0.9)';
const METAL = ['#9aa0a8', '#f4f5f7', '#858b94'];
const DARK = ['#3a3f47', '#7b838f', '#30343b'];

/* Draw one part. In the part's own frame +x points away from the craft centreline for side parts. */
function drawPart(ctx, p, lw) {
  const d = p.def, h = d.h, top = p.top, bot = p.bot;
  const hw = d.w / 2, hb = (d.wb !== undefined ? d.wb : d.w) / 2;
  ctx.save();
  ctx.translate(p.x, 0);
  if (p.flip) ctx.scale(-1, 1);
  if (p.inv) { ctx.translate(0, top + bot); ctx.scale(1, -1); }
  ctx.lineWidth = lw;
  ctx.strokeStyle = OUTLINE;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (d.kind) {
    case 'pod': {
      ctx.fillStyle = cylGrad(ctx, -hb, hb, '#8a9099', '#f2f4f7', '#727882');
      poly(ctx, [[-hb, bot + 0.12], [hb, bot + 0.12], [hw * 0.93, top], [-hw * 0.93, top]]); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#6b4a2e';
      poly(ctx, [[-hb - 0.02, bot], [hb + 0.02, bot], [hb, bot + 0.14], [-hb, bot + 0.14]]); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1d3a5c';
      poly(ctx, [[-0.32, bot + 0.62], [0.32, bot + 0.62], [0.24, bot + 1.0], [-0.24, bot + 1.0]]); ctx.fill();
      ctx.fillStyle = 'rgba(160,215,255,0.55)';
      poly(ctx, [[-0.26, bot + 0.66], [-0.06, bot + 0.66], [-0.12, bot + 0.95], [-0.2, bot + 0.95]]); ctx.fill();
      ctx.fillStyle = '#c94a2c'; ctx.fillRect(-hw * 0.93, top - 0.08, hw * 1.86, 0.08);
      break;
    }
    case 'chuteSide': {
      ctx.fillStyle = cylGrad(ctx, -hw, hw, '#9c3a1f', '#f06a3c', '#8a321a');
      ctx.beginPath(); ctx.roundRect(-hw, bot, 2 * hw, h, hw * 0.8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3b414b'; ctx.fillRect(-hw, bot + h * 0.45, 2 * hw, 0.08);
      break;
    }
    case 'chute': {
      ctx.fillStyle = cylGrad(ctx, -hw, hw, '#9c3a1f', '#f06a3c', '#8a321a');
      poly(ctx, [[-hw * 0.93, bot], [hw * 0.93, bot], [hw * 0.66, top], [-hw * 0.66, top]]); ctx.fill(); ctx.stroke();
      break;
    }
    case 'wheel': {
      ctx.fillStyle = cylGrad(ctx, -hw, hw, ...DARK);
      ctx.fillRect(-hw, bot, 2 * hw, h); ctx.strokeRect(-hw, bot, 2 * hw, h);
      ctx.fillStyle = '#e0b030'; ctx.fillRect(-hw, bot + h * 0.4, 2 * hw, h * 0.2);
      break;
    }
    case 'tank': {
      ctx.fillStyle = cylGrad(ctx, -hw, hw, ...METAL);
      ctx.fillRect(-hw, bot, 2 * hw, h); ctx.strokeRect(-hw, bot, 2 * hw, h);
      ctx.fillStyle = '#3b414b';
      ctx.fillRect(-hw, top - 0.1, 2 * hw, 0.1); ctx.fillRect(-hw, bot, 2 * hw, 0.1);
      if (h > 1.5) {
        ctx.fillStyle = hw > 1.2 ? '#c8642c' : '#2b2f36';
        const n = Math.round(h / 1.8);
        for (let i = 1; i <= n; i++) { const y = bot + (h * i) / (n + 1); ctx.fillRect(-hw, y - 0.06, 2 * hw, 0.12); }
      }
      const frac = d.fuel ? p.fuel / d.fuel : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(hw * 0.62, bot + 0.18, 0.14, h - 0.36);
      ctx.fillStyle = '#f0a030'; ctx.fillRect(hw * 0.62, bot + 0.18, 0.14, (h - 0.36) * frac);
      break;
    }
    case 'radtank': {
      ctx.fillStyle = cylGrad(ctx, -hw, hw, ...METAL);
      ctx.beginPath(); ctx.roundRect(-hw, bot, 2 * hw, h, hw * 0.9); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2b2f36'; ctx.fillRect(-hw, bot + h * 0.47, 2 * hw, 0.1);
      const frac = d.fuel ? p.fuel / d.fuel : 0;
      ctx.fillStyle = '#f0a030'; ctx.fillRect(hw * 0.25, bot + 0.3, 0.1, (h - 0.6) * frac);
      break;
    }
    case 'monotank': {
      ctx.fillStyle = cylGrad(ctx, -hw, hw, '#7f9a86', '#e4f2e6', '#6f8a76');
      ctx.beginPath(); ctx.ellipse(0, bot + h / 2, hw, h / 2, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#3d5a45'; ctx.beginPath(); ctx.moveTo(-hw, bot + h / 2); ctx.lineTo(hw, bot + h / 2); ctx.stroke();
      break;
    }
    case 'decoupler': {
      ctx.fillStyle = '#2a2e35'; ctx.fillRect(-hw - 0.04, bot, 2 * hw + 0.08, h); ctx.strokeRect(-hw - 0.04, bot, 2 * hw + 0.08, h);
      ctx.fillStyle = '#e8b923'; ctx.fillRect(-hw - 0.04, bot + h * 0.38, 2 * hw + 0.08, h * 0.24);
      break;
    }
    case 'raddec': {
      ctx.fillStyle = '#2a2e35'; ctx.fillRect(-hw, bot, 2 * hw, h); ctx.strokeRect(-hw, bot, 2 * hw, h);
      ctx.fillStyle = d.crossfeed ? '#4fd1ff' : '#e8b923'; ctx.fillRect(-hw * 0.3, bot + 0.1, hw * 0.6, h - 0.2);
      break;
    }
    case 'mount': {
      ctx.fillStyle = cylGrad(ctx, -hb, hb, '#4a505a', '#a9b0ba', '#3e434b');
      poly(ctx, [[-hb, bot], [hb, bot], [hw, top], [-hw, top]]); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e0b030'; ctx.fillRect(-hw, top - 0.08, 2 * hw, 0.08);
      ctx.fillStyle = '#23272e';
      for (const sx of d.slots) ctx.fillRect(sx - 0.38, bot, 0.76, 0.12);
      break;
    }
    case 'adapter': {
      ctx.fillStyle = cylGrad(ctx, -Math.max(hw, hb), Math.max(hw, hb), ...METAL);
      poly(ctx, [[-hb, bot], [hb, bot], [hw, top], [-hw, top]]); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3b414b'; ctx.fillRect(-hb, bot, 2 * hb, 0.08); ctx.fillRect(-hw, top - 0.08, 2 * hw, 0.08);
      break;
    }
    case 'nose': {
      ctx.fillStyle = cylGrad(ctx, -hb, hb, ...METAL);
      ctx.beginPath();
      ctx.moveTo(-hb, bot); ctx.lineTo(hb, bot);
      ctx.quadraticCurveTo(hb, bot + h * 0.75, hw, top);
      ctx.lineTo(-hw, top);
      ctx.quadraticCurveTo(-hb, bot + h * 0.75, -hb, bot);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c8402f'; ctx.fillRect(-hb, bot, 2 * hb, 0.12);
      break;
    }
    case 'pylon': {
      ctx.fillStyle = '#4a505a'; ctx.fillRect(-hw, bot, 2 * hw, h); ctx.strokeRect(-hw, bot, 2 * hw, h);
      ctx.strokeStyle = '#9aa2ad'; ctx.lineWidth = Math.max(lw, 0.05);
      ctx.beginPath();
      for (let y = bot; y < top - 0.01; y += 2 * hw) { ctx.moveTo(-hw, y); ctx.lineTo(hw, Math.min(top, y + 2 * hw)); }
      ctx.stroke();
      break;
    }
    case 'fins': {
      ctx.fillStyle = '#c23b2a';
      poly(ctx, [[-hw, top], [hw, bot + h * 0.32], [hw, bot], [-hw, bot]]); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      poly(ctx, [[-hw, top], [-hw + 0.12, top - 0.2], [-hw + 0.12, bot], [-hw, bot]]); ctx.fill();
      break;
    }
    case 'legs': {
      const fx = p.footX !== undefined ? Math.abs(p.footX - p.x) : 1.3;
      const fy = p.footY !== undefined ? p.footY : bot - 0.9;
      ctx.strokeStyle = '#59606b'; ctx.lineWidth = 0.14;
      ctx.beginPath();
      ctx.moveTo(-hw + 0.15, top - 0.15); ctx.lineTo(fx, fy + 0.1);
      ctx.moveTo(-hw + 0.15, bot + 0.1); ctx.lineTo(lerp(-hw, fx, 0.6), lerp(bot, fy, 0.55));
      ctx.stroke();
      ctx.fillStyle = '#3a3f47'; ctx.fillRect(fx - 0.35, fy, 0.7, 0.12);
      ctx.lineWidth = lw; ctx.strokeStyle = OUTLINE;
      ctx.fillStyle = cylGrad(ctx, -hw, hw, '#4a505a', '#9aa2ad', '#40454d');
      ctx.fillRect(-hw, bot, 2 * hw * 0.55, h); ctx.strokeRect(-hw, bot, 2 * hw * 0.55, h);
      break;
    }
    case 'rcs': {
      ctx.fillStyle = '#d8d0b8'; ctx.fillRect(-hw, bot, 2 * hw, h); ctx.strokeRect(-hw, bot, 2 * hw, h);
      ctx.fillStyle = '#2f3238';
      poly(ctx, [[hw, bot + h * 0.35], [hw + 0.15, bot + h * 0.25], [hw + 0.15, bot + h * 0.75], [hw, bot + h * 0.65]]); ctx.fill();
      poly(ctx, [[-0.08, top], [0.08, top], [0.13, top + 0.12], [-0.13, top + 0.12]]); ctx.fill();
      poly(ctx, [[-0.08, bot], [0.08, bot], [0.13, bot - 0.12], [-0.13, bot - 0.12]]); ctx.fill();
      break;
    }
    case 'sensor': {
      ctx.fillStyle = '#d6d9de'; ctx.fillRect(-hw, bot, 2 * hw, h); ctx.strokeRect(-hw, bot, 2 * hw, h);
      ctx.fillStyle = '#2a2e35'; ctx.fillRect(-hw * 0.6, bot + h * 0.2, hw * 1.2, h * 0.6);
      ctx.fillStyle = d.dial ? '#7dffa8' : '#ff8a4d';
      ctx.beginPath(); ctx.arc(0, bot + h / 2, hw * 0.35, 0, TAU); ctx.fill();
      break;
    }
    case 'jar': {
      ctx.fillStyle = cylGrad(ctx, -hw, hw, '#9aa0a8', '#eef0f3', '#858b94');
      ctx.fillRect(-hw, bot + 0.1, 2 * hw, h - 0.2); ctx.strokeRect(-hw, bot + 0.1, 2 * hw, h - 0.2);
      ctx.fillStyle = 'rgba(120,200,140,0.75)'; ctx.fillRect(-hw * 0.55, bot + 0.2, hw * 1.1, (h - 0.4) * (p.spent ? 0.1 : 0.6));
      ctx.fillStyle = '#3b414b'; ctx.fillRect(-hw, top - 0.12, 2 * hw, 0.12); ctx.fillRect(-hw, bot, 2 * hw, 0.12);
      break;
    }
    case 'spike': {
      ctx.fillStyle = '#5b616b'; ctx.fillRect(-hw, top - h * 0.35, 2 * hw, h * 0.35); ctx.strokeRect(-hw, top - h * 0.35, 2 * hw, h * 0.35);
      ctx.fillStyle = '#c9a23a';
      poly(ctx, [[-hw * 0.45, top - h * 0.35], [hw * 0.45, top - h * 0.35], [0, bot]]); ctx.fill(); ctx.stroke();
      break;
    }
    case 'sniffer': {
      ctx.fillStyle = '#e6e2d6'; ctx.fillRect(-hw, bot, 2 * hw, h); ctx.strokeRect(-hw, bot, 2 * hw, h);
      ctx.fillStyle = '#2a2e35';
      poly(ctx, [[hw, top - 0.1], [hw + 0.2, top - 0.05], [hw + 0.2, top - 0.3], [hw, top - 0.25]]); ctx.fill();
      ctx.fillStyle = '#4fd1ff'; ctx.fillRect(-hw * 0.5, bot + h * 0.3, hw, h * 0.15);
      break;
    }
    case 'antenna': {
      ctx.fillStyle = '#4a505a'; ctx.fillRect(-hw, bot, 2 * hw, 0.3); ctx.strokeRect(-hw, bot, 2 * hw, 0.3);
      ctx.strokeStyle = '#c8ccd2'; ctx.lineWidth = Math.max(lw, 0.05);
      ctx.beginPath(); ctx.moveTo(0, bot + 0.3); ctx.lineTo(0, top); ctx.stroke();
      ctx.fillStyle = '#ff5d5d'; ctx.beginPath(); ctx.arc(0, top, 0.08, 0, TAU); ctx.fill();
      break;
    }
    case 'dock': {
      ctx.fillStyle = cylGrad(ctx, -hw, hw, ...DARK);
      ctx.fillRect(-hw, bot, 2 * hw, h * 0.6); ctx.strokeRect(-hw, bot, 2 * hw, h * 0.6);
      ctx.fillStyle = '#c9cdd4';
      poly(ctx, [[-hw * 0.8, bot + h * 0.6], [hw * 0.8, bot + h * 0.6], [hw * 0.55, top], [-hw * 0.55, top]]); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffd34d'; ctx.fillRect(-hw * 0.5, top - 0.06, hw, 0.06);
      break;
    }
    case 'probe': {
      ctx.fillStyle = cylGrad(ctx, -hw, hw, '#4a505a', '#b8bec8', '#3e434b');
      poly(ctx, [[-hw, bot], [hw, bot], [hw * 0.8, top], [-hw * 0.8, top]]); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffd34d'; ctx.fillRect(-hw * 0.55, bot + h * 0.35, hw * 1.1, h * 0.25);
      ctx.fillStyle = '#7dffa8'; ctx.beginPath(); ctx.arc(hw * 0.35, bot + h * 0.47, 0.06, 0, TAU); ctx.fill();
      break;
    }
    case 'battery': {
      ctx.fillStyle = '#3a3f47'; ctx.fillRect(-hw, bot, 2 * hw, h); ctx.strokeRect(-hw, bot, 2 * hw, h);
      ctx.fillStyle = '#e0b030'; ctx.fillRect(-hw * 0.5, top - 0.1, hw, 0.08);
      ctx.fillStyle = '#7dffa8'; ctx.fillRect(-hw * 0.6, bot + 0.08, hw * 1.2, (h - 0.25) * (p.def.ec ? p.ec / p.def.ec : 0));
      break;
    }
    case 'batring': {
      ctx.fillStyle = cylGrad(ctx, -hw, hw, ...DARK); ctx.fillRect(-hw, bot, 2 * hw, h); ctx.strokeRect(-hw, bot, 2 * hw, h);
      ctx.fillStyle = '#e0b030';
      for (let x = -hw + 0.2; x < hw - 0.1; x += 0.4) ctx.fillRect(x, bot + h * 0.3, 0.2, h * 0.4);
      break;
    }
    case 'solar': {
      ctx.fillStyle = '#59606b'; ctx.fillRect(-hw, bot + h * 0.4, hw * 1.2, h * 0.2);
      ctx.fillStyle = '#1d3a7a'; ctx.fillRect(-hw * 0.2, bot, hw * 1.2, h); ctx.strokeRect(-hw * 0.2, bot, hw * 1.2, h);
      ctx.strokeStyle = 'rgba(140,190,255,0.6)'; ctx.lineWidth = Math.max(lw, 0.03);
      ctx.beginPath();
      for (let y = bot + h / 6; y < top - 0.01; y += h / 6) { ctx.moveTo(-hw * 0.2, y); ctx.lineTo(hw, y); }
      ctx.stroke();
      break;
    }
    case 'shield': {
      const frac = d.ablator ? p.ablator / d.ablator : 0;
      ctx.fillStyle = mixColor('#3a2a1e', '#8a5a2e', frac);
      ctx.beginPath(); ctx.moveTo(-hw - 0.05, top); ctx.lineTo(hw + 0.05, top);
      ctx.quadraticCurveTo(hw * 0.9, bot - 0.05, 0, bot - 0.1); ctx.quadraticCurveTo(-hw * 0.9, bot - 0.05, -hw - 0.05, top);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'engine': {
      const mh = h * 0.3, bw = d.bell / 2;
      ctx.fillStyle = '#3a3f48';
      poly(ctx, [[-hw, top], [hw, top], [hw * 0.55, top - mh], [-hw * 0.55, top - mh]]); ctx.fill(); ctx.stroke();
      ctx.fillStyle = cylGrad(ctx, -bw, bw, '#2a2d33', '#9aa0aa', '#24272c');
      const yb = top - mh, tw = Math.min(0.38, hw * 0.4);
      ctx.beginPath();
      ctx.moveTo(-tw, yb); ctx.lineTo(tw, yb);
      ctx.quadraticCurveTo(tw * 1.1, lerp(yb, bot, 0.65), bw, bot);
      ctx.lineTo(-bw, bot);
      ctx.quadraticCurveTo(-tw * 1.1, lerp(yb, bot, 0.65), -tw, yb);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5b616b'; ctx.fillRect(-bw, bot, 2 * bw, 0.07);
      break;
    }
    case 'srb': {
      const nz = Math.min(0.55, h * 0.18), bw = hw * 0.92;
      ctx.fillStyle = cylGrad(ctx, -bw, bw, '#a7abb2', '#fbfbfb', '#8f949c');
      ctx.fillRect(-bw, bot + nz, 2 * bw, h - nz); ctx.strokeRect(-bw, bot + nz, 2 * bw, h - nz);
      ctx.fillStyle = '#c8402f';
      for (const f of [0.18, 0.55]) ctx.fillRect(-bw, bot + nz + (h - nz) * f, 2 * bw, 0.3);
      ctx.fillStyle = '#3b414b'; ctx.fillRect(-bw, top - 0.12, 2 * bw, 0.12);
      ctx.fillStyle = '#2f3238';
      poly(ctx, [[-bw * 0.38, bot + nz], [bw * 0.38, bot + nz], [bw * 0.67, bot], [-bw * 0.67, bot]]); ctx.fill(); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

function flameHalfWidth(d) { return d.kind === 'srb' ? (d.w / 2) * 0.62 : d.bell / 2; }

function drawFlame(ctx, p, pressure, flick) {
  const d = p.def;
  const bw = flameHalfWidth(d);
  const vac = 1 - clamp(pressure, 0, 1);
  const L = (2.5 + 6 * p.burn) * (1 + 1.6 * vac) * Math.pow(d.thrust / 150, 0.35) * flick;
  const w1 = bw * (0.6 + 2.2 * vac);
  const y0 = p.bot;
  ctx.save();
  ctx.translate(p.x, 0);
  if (p.inv) { ctx.translate(0, p.top + p.bot); ctx.scale(1, -1); }
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
  ctx.restore();
}

function drawCanopy(ctx, c) {
  const chutes = c.parts.filter((p) => p.def.chute);
  if (!chutes.length) return;
  const s = (Math.sqrt(c.chuteArea) * 0.6) / Math.sqrt(chutes.length);
  const L = s * 1.1 + 2;
  for (const cp of chutes) {
    const y0 = cp.top, x0 = cp.x + (cp.def.radial ? (cp.flip ? -1 : 1) * s * 0.6 : 0);
    ctx.save();
    ctx.translate(x0, 0);
    ctx.strokeStyle = 'rgba(235,235,235,0.85)';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    for (const f of [-1, -0.5, 0.5, 1]) { ctx.moveTo(cp.x - x0, y0); ctx.lineTo(f * s, y0 + L); }
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
    ctx.restore();
  }
}

/* Draw a craft in world space; ctx is already in world-metre coordinates centred on `cam`. */
function drawCraft(ctx, c, cam, zoom, pressure) {
  ctx.save();
  ctx.translate(c.pos[0] - cam[0], c.pos[1] - cam[1]);
  ctx.rotate(c.angle - Math.PI / 2);
  ctx.translate(-c.xc, -c.yc);
  if (c.chuteArea > 1 && c.hasChute) drawCanopy(ctx, c);
  ctx.globalCompositeOperation = 'lighter';
  const flick = 0.9 + Math.random() * 0.2;
  for (const p of c.parts) if (p.burn > 0) drawFlame(ctx, p, pressure, flick);
  if (c.rcsFiring > 0.05) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const p of c.rcsParts) {
      const s = p.flip ? -1 : 1;
      ctx.beginPath(); ctx.arc(p.x + s * (p.def.w / 2 + 0.35), (p.top + p.bot) / 2, 0.25 + Math.random() * 0.2, 0, TAU); ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  const lw = Math.max(0.03, 1 / zoom);
  for (const p of c.parts) drawPart(ctx, p, lw);
  // red-hot parts glow
  ctx.globalCompositeOperation = 'lighter';
  for (const p of c.parts) {
    if (!(p.temp > 800)) continue;
    const a = clamp((p.temp - 800) / (partMaxTemp(p.def) - 800), 0, 1) * 0.75;
    const hw = maxWidth(p.def) / 2;
    ctx.fillStyle = `rgba(255,${Math.round(120 - 80 * a)},30,${a.toFixed(3)})`;
    ctx.fillRect(p.x - hw, p.bot, 2 * hw, p.def.h);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

/* Small icon of a single part for the parts palette. */
function drawPartIcon(canvas, id, W = 46, H = 54) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  const def = PART_DEFS[id];
  const p = { def, x: 0, top: 0, bot: -def.h, flip: false, fuel: def.fuel || 0, solid: def.solid || 0, mono: def.mono || 0 };
  let x0 = -maxWidth(def) / 2 - 0.1, x1 = maxWidth(def) / 2 + 0.1, yTop = 0, yBot = -def.h;
  if (def.kind === 'legs') { p.footX = 1.3; p.footY = -def.h - 0.9; x1 = 1.75; yBot = p.footY; }
  if (def.kind === 'rcs') { x1 += 0.2; yTop += 0.15; yBot -= 0.15; }
  const s = Math.min((W - 6) / (x1 - x0), (H - 6) / (yTop - yBot));
  ctx.setTransform(dpr * s, 0, 0, -dpr * s, dpr * (W / 2 - ((x0 + x1) / 2) * s), dpr * (H / 2 + ((yTop + yBot) / 2) * s));
  drawPart(ctx, p, 1 / s);
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
  ctx.fillStyle = b.gas ? b.colLand : b.colSoil;
  ctx.fill();
  if (b.gas) {
    // cloud bands, level with the viewer's horizon
    ctx.save();
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(camAng - Math.PI / 2);
    const cols = ['rgba(150,100,55,0.35)', 'rgba(255,240,215,0.3)', 'rgba(120,80,45,0.3)'];
    for (let i = -9; i <= 9; i++) {
      ctx.fillStyle = cols[(i + 9) % 3];
      ctx.fillRect(-b.R, b.R * (i / 10) - b.R * 0.03, 2 * b.R, b.R * (0.04 + 0.03 * ((i * 7 + 9) % 3)));
    }
    ctx.restore();
  }
  if (full && !b.gas) shadeNightSide(ctx, b, t, cx, cy);
  // surface layer, coloured by height (beaches, grass, rock, snow...)
  ctx.lineWidth = Math.max(5 / zoom, 1.5);
  const pal = terrainPalette(b);
  const buckets = pal.map(() => []);
  for (let i = 0; i < N; i++) buckets[terrainBucket(b, (hs[i] + hs[i + 1]) / 2)].push(i);
  pal.forEach((col, k) => {
    if (!buckets[k].length) return;
    ctx.strokeStyle = col;
    ctx.beginPath();
    for (const i of buckets[k]) { ctx.moveTo(xs[i], ys[i]); ctx.lineTo(xs[i + 1], ys[i + 1]); }
    ctx.stroke();
  });
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

/* Colours for the surface layer, low to high. */
const TERRAIN_PALETTES = {
  verdan: ['#d2bd86', '#4f8f3a', '#3c7630', '#7d7468', '#eef3f6'],
  gale: ['#cdbf8e', '#3f8f7a', '#337565', '#6d7a70', '#dfeee8'],
};
function terrainPalette(b) {
  if (TERRAIN_PALETTES[b.id]) return TERRAIN_PALETTES[b.id];
  if (!b._pal) b._pal = [mixColor(b.colLand, '#000000', 0.25), mixColor(b.colLand, '#000000', 0.1), b.colLand, mixColor(b.colLand, '#ffffff', 0.2), mixColor(b.colLand, '#ffffff', 0.4)];
  return b._pal;
}
function terrainBucket(b, h) {
  if (b.id === 'verdan' || b.id === 'gale') return h < 15 ? 0 : h < 380 ? 1 : h < 650 ? 2 : h < 860 ? 3 : 4;
  if (!b._amp) b._amp = b.terrain.reduce((a, x) => a + Math.abs(x[0]), 0) || 1;
  return clamp(Math.floor(((h - b.hOff + b._amp) / (2 * b._amp)) * 5), 0, 4);
}

/* Darken the half of a planet facing away from Helion (the current path must be the planet's outline). */
function shadeNightSide(ctx, b, t, cx, cy, R = b.R, flipY = false) {
  if (b.star) return;
  const sun = bodyPos(SUN, t), bp = bodyPos(b, t);
  const dx = sun[0] - bp[0], dy = (sun[1] - bp[1]) * (flipY ? -1 : 1), d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
  ctx.save();
  ctx.clip();
  const g = ctx.createLinearGradient(cx + ux * R * 0.15, cy + uy * R * 0.15, cx - ux * R, cy - uy * R);
  g.addColorStop(0, 'rgba(0,0,12,0)'); g.addColorStop(0.25, 'rgba(0,0,12,0.55)'); g.addColorStop(1, 'rgba(0,0,12,0.7)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);
  ctx.restore();
}

/* How much daylight there is where the craft is: 1 = full day, 0 = night. */
function daylight(c, b, t) {
  if (!b || b.star) return 1;
  const sun = bodyPos(SUN, t), bp = bodyPos(b, t);
  const ux = c.pos[0] - bp[0], uy = c.pos[1] - bp[1], ul = Math.hypot(ux, uy);
  const sx = sun[0] - c.pos[0], sy = sun[1] - c.pos[1], sl = Math.hypot(sx, sy);
  const elev = (ux * sx + uy * sy) / (ul * sl);
  const alt = ul - b.R;
  // high up, the horizon drops away, so night only falls when you're properly behind the planet
  const dip = -Math.acos(clamp(b.R / ul, -1, 1));
  void alt;
  return smoothstep(Math.sin(dip) - 0.12, Math.sin(dip) + 0.12, elev);
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

/* The star, seen from up close: a bright disc with a glow. */
function drawStarWorld(ctx, b, t, cam, viewR) {
  const bp = bodyPos(b, t);
  const x = bp[0] - cam[0], y = bp[1] - cam[1];
  if (Math.hypot(x, y) - b.R * 2.5 > viewR) return;
  const g = ctx.createRadialGradient(x, y, b.R * 0.9, x, y, b.R * 2.5);
  g.addColorStop(0, 'rgba(255,220,120,0.8)'); g.addColorStop(1, 'rgba(255,160,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, b.R * 2.5, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff3c4';
  ctx.beginPath(); ctx.arc(x, y, b.R, 0, TAU); ctx.fill();
}
