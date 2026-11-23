'use strict';
/* Rocketwright — anomalies: strange things left on the worlds for you to find. Get within ANOMALY_FIND metres of one,
   landed or flying low, to discover it (a milestone, money and science). A ground scanner picks up their signal from
   ANOMALY_HINT away, and they show up in the world view (and later on the map) once you're close. */

const ANOMALY_FIND = 150, ANOMALY_HINT = 50000, ANOMALY_SHOW = 25000;
const ANOMALIES = [
  { id: 'beacon', body: 'verdan', phi: PAD_PHI + 0.93, name: 'The Old Beacon', kind: 'beacon', desc: 'A rusted mast with a red light that still blinks. Nobody at the Space Centre knows who built it.' },
  { id: 'pillar', body: 'pallid', phi: 2.1, name: 'The Black Pillar', kind: 'pillar', desc: 'A perfectly smooth black column, taller than any rocket. It hums on every radio band at once.' },
  { id: 'ring', body: 'ochre', phi: 4.0, name: 'The Stone Ring', kind: 'arch', desc: 'A great arch of red stone. The wind has no business carving anything this neat.' },
  { id: 'probe', body: 'shard', phi: 0.7, name: 'The Forgotten Probe', kind: 'wreck', desc: 'A battered little probe with nobody\'s markings on it, its antenna still turning.' },
  { id: 'statue', body: 'gale', phi: 1.5, name: 'The Wading Giant', kind: 'statue', desc: 'A worn stone figure as tall as a tower, looking out to sea.' },
  { id: 'egg', body: 'ember', phi: 3.6, name: 'The Iron Egg', kind: 'egg', desc: 'A dark metal egg, warm to the touch even on the night side.' },
  { id: 'spire', body: 'frost', phi: 5.2, name: 'The Glass Spire', kind: 'spire', desc: 'A needle of clear ice, or something like ice, catching what little light reaches Frost.' },
  { id: 'watcher', body: 'umbra', phi: 3.3, name: 'The Watcher', kind: 'head', desc: 'A huge carved face half buried in the dark plains, eyes turned towards Helion.' },
];
/* Keep them on dry land. */
for (const a of ANOMALIES) {
  const b = BODY_BY_ID[a.body];
  for (let k = 0; k < 400 && b.ocean && terrainH(b, a.phi) < 8; k++) a.phi += 1500 / b.R;
}
const ANOMALY_BY_ID = Object.fromEntries(ANOMALIES.map((a) => [a.id, a]));

function anomalyFound(id) { return !!loadMilestones()['anomaly_' + id]; }

/* Anomalies on a body within a distance (metres along the ground) of the craft, nearest first. */
function anomaliesNear(c, b, range) {
  const bp = bodyPos(b, F.t), me = Math.atan2(c.pos[1] - bp[1], c.pos[0] - bp[0]), out = [];
  for (const a of ANOMALIES) {
    if (a.body !== b.id) continue;
    const da = wrapPi(a.phi - me), d = Math.abs(da) * b.R;
    if (d < range) out.push({ a, d, dir: da > 0 ? -1 : 1 });
  }
  return out.sort((x, y) => x.d - y.d);
}

/* Each frame (cheap): discover anomalies the craft is right next to, and let a scanner hint at others. */
function anomalyTick(c, b) {
  if (c.dead || b.star || b.gas) return;
  for (const n of anomaliesNear(c, b, ANOMALY_HINT)) {
    if (anomalyFound(n.a.id)) continue;
    if (n.d < ANOMALY_FIND && (c.landed || (c.radar || 1e9) < 300)) discoverAnomaly(n.a);
    else if (c.parts.some((p) => p.def.scanner) && F.anomalyHint !== n.a.id) {
      F.anomalyHint = n.a.id;
      flash(`📡 The scanner picks up something strange on ${b.name}, ${fmtDist(n.d)} ${n.dir > 0 ? 'to the right ▶' : 'to the left ◀'}`, 5);
    }
  }
}

function discoverAnomaly(a) {
  const b = BODY_BY_ID[a.body];
  award('anomaly_' + a.id);
  if (isCareer()) addScience(30 * (BODY_SCI[b.id] || 1) * diff('science'));
  logEvent(`Discovered ${a.name} on ${b.name}`);
  playSound('dock');
  flash(`✨ Discovered ${a.name}! ${a.desc}`, 8);
  if (isCareer()) toast(`Discovery: ${a.name} · +${fmtNum(30 * (BODY_SCI[b.id] || 1) * diff('science'), 0)} ⚗`);
  persist();
}

/* ---------------- drawing (2D, in metres, y up from the ground) ---------------- */

function drawAnomaly2D(ctx, a, lw) {
  ctx.lineWidth = lw;
  ctx.strokeStyle = '#111';
  const rect = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); };
  switch (a.kind) {
    case 'beacon': {
      ctx.strokeStyle = '#8a4a2a'; ctx.lineWidth = Math.max(lw, 0.25);
      ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(0, 14); ctx.lineTo(2, 0); ctx.moveTo(-1.4, 4); ctx.lineTo(1.4, 4); ctx.moveTo(-0.8, 8.5); ctx.lineTo(0.8, 8.5); ctx.stroke();
      ctx.fillStyle = Math.floor((F.t || 0) * 1.2) % 2 ? '#ff3a2a' : '#5a1a12'; ctx.beginPath(); ctx.arc(0, 14.3, 0.5, 0, TAU); ctx.fill();
      break;
    }
    case 'pillar': rect(-2, 0, 4, 18, '#0c0c10'); ctx.fillStyle = 'rgba(160,170,255,0.15)'; ctx.fillRect(-1.8, 0, 0.6, 18); break;
    case 'arch': {
      ctx.fillStyle = '#b0623a';
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-11, 0); ctx.lineTo(-11, 11); ctx.arc(0, 11, 11, Math.PI, 0, true); ctx.lineTo(11, 0); ctx.lineTo(16, 0);
      ctx.lineTo(16, 13); ctx.arc(0, 13, 16, 0, Math.PI, false); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'wreck': {
      ctx.save(); ctx.rotate(0.35);
      rect(-1.2, 0, 2.4, 1.6, '#8a8f96'); rect(1.2, 0.4, 2.2, 0.7, '#1d3a7a');
      ctx.strokeStyle = '#c9ccd1'; ctx.beginPath(); ctx.moveTo(0, 1.6); ctx.lineTo(-0.6, 3.2); ctx.lineTo(0.4, 3.8); ctx.stroke();
      ctx.restore();
      break;
    }
    case 'statue': {
      ctx.fillStyle = '#6e7a6a';
      ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(-2.2, 7); ctx.lineTo(-4, 12); ctx.lineTo(-3, 13); ctx.lineTo(-1.6, 10); ctx.lineTo(-2, 14);
      ctx.lineTo(2, 14); ctx.lineTo(1.6, 10); ctx.lineTo(3, 13); ctx.lineTo(4, 12); ctx.lineTo(2.2, 7); ctx.lineTo(3, 0); ctx.lineTo(0.6, 0); ctx.lineTo(0, 5); ctx.lineTo(-0.6, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 15.8, 1.9, 0, TAU); ctx.fill(); ctx.stroke();
      break;
    }
    case 'egg': ctx.fillStyle = '#3a3530'; ctx.beginPath(); ctx.ellipse(0, 3.2, 2.2, 3.2, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,120,60,0.35)'; ctx.beginPath(); ctx.ellipse(-0.6, 3.8, 0.5, 1.2, 0.3, 0, TAU); ctx.fill(); break;
    case 'spire': ctx.fillStyle = 'rgba(190,230,255,0.75)'; ctx.beginPath(); ctx.moveTo(-2.5, 0); ctx.lineTo(0, 26); ctx.lineTo(2.5, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
    case 'head': {
      ctx.fillStyle = '#4a3d5c'; ctx.beginPath(); ctx.ellipse(0, 4, 7, 9, 0, Math.PI, TAU); ctx.lineTo(7, 0); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-7, 4); ctx.lineTo(-7, 0); ctx.lineTo(7, 0); ctx.lineTo(7, 4); ctx.fill();
      ctx.fillStyle = '#1a1424'; ctx.fillRect(-4, 7, 2.4, 1.2); ctx.fillRect(1.6, 7, 2.4, 1.2); ctx.fillRect(-2.5, 2.5, 5, 0.8);
      break;
    }
  }
}
