'use strict';
/* Rocketwright — the crew in flight: portraits that react to what's happening, and each vessel's flight log. */

/* ---------------- flight log ---------------- */

/* Note something that happened to the vessel being flown (kept with the vessel). */
function logEvent(text) {
  if (!F.flags) return;
  const log = F.flags.log || (F.flags.log = []);
  log.push({ t: F.t, text });
  if (log.length > 80) log.splice(0, log.length - 80);
}
/* The log as HTML list items, newest last. */
function logHtml(log, launchT, max = 80) {
  return (log || []).slice(-max).map((e) => `<li><span class="muted">T+${fmtDur(Math.max(0, e.t - launchT))}</span> ${esc(e.text)}</li>`).join('');
}

/* ---------------- portraits ---------------- */

const SKIN = ['#f2d0b0', '#e3b58e', '#c88f64', '#9c6743', '#6e4630'];
const HAIR = ['#2a1d14', '#5a3a1e', '#a8743a', '#d8b060', '#8a2e1e', '#3a3a3a'];
function nameHash(n) { let h = 7; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0; return h; }

/* How the crew feel right now: calm, thrilled (just staged), straining (high g) or scared (danger). */
function crewMood(c, vs) {
  if (c.dead) return 'scared';
  const hot = c.hottest && c.hottest.temp / partMaxTemp(c.hottest.def) > 0.8;
  if (hot || (!c.landed && c.radar < 400 && vs < -30)) return 'scared';
  if ((c.gforce || 0) > 3.5) return 'strain';
  if (F.t - (F.lastStageT ?? -99) < 2.5) return 'thrill';
  return 'calm';
}

/* An original cartoon face in a round helmet. */
function drawFace(cv, name, mood) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = 46, H = 50;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
  const x = cv.getContext('2d'), h = nameHash(name);
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, W, H);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1d2b45'); g.addColorStop(1, '#0d1424');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // suit collar and helmet
  x.fillStyle = '#e8ebef'; x.fillRect(8, 40, 30, 10);
  x.fillStyle = '#e07b2c'; x.fillRect(8, 42, 30, 3);
  x.fillStyle = 'rgba(200,220,255,0.18)'; x.beginPath(); x.arc(23, 24, 19, 0, TAU); x.fill();
  x.strokeStyle = '#e8ebef'; x.lineWidth = 3; x.beginPath(); x.arc(23, 24, 19, 0, TAU); x.stroke();
  // face and hair
  x.fillStyle = SKIN[h % SKIN.length]; x.beginPath(); x.ellipse(23, 26, 12, 13, 0, 0, TAU); x.fill();
  x.fillStyle = HAIR[(h >>> 4) % HAIR.length]; x.beginPath(); x.ellipse(23, 17, 12, 6, 0, Math.PI, TAU); x.fill();
  x.fillRect(11, 16, 24, 3);
  // eyes
  x.fillStyle = '#1b1e23'; x.strokeStyle = '#1b1e23'; x.lineWidth = 1.6;
  const ey = 25;
  for (const ex of [18, 28]) {
    if (mood === 'thrill') { x.beginPath(); x.arc(ex, ey + 1.5, 2.4, Math.PI * 1.1, Math.PI * 1.9); x.stroke(); }
    else if (mood === 'strain') { x.beginPath(); x.moveTo(ex - 2.5, ey - 0.5); x.lineTo(ex + 2.5, ey + 0.5); x.stroke(); }
    else if (mood === 'scared') { x.fillStyle = '#fff'; x.beginPath(); x.arc(ex, ey, 3, 0, TAU); x.fill(); x.fillStyle = '#1b1e23'; x.beginPath(); x.arc(ex, ey, 1.3, 0, TAU); x.fill(); }
    else { x.beginPath(); x.arc(ex, ey, 1.5, 0, TAU); x.fill(); }
  }
  // mouth
  x.lineWidth = 1.6;
  if (mood === 'thrill') { x.fillStyle = '#5a1e1e'; x.beginPath(); x.arc(23, 31, 4.5, 0, Math.PI); x.fill(); }
  else if (mood === 'strain') { x.fillStyle = '#fff'; x.fillRect(19, 31, 8, 3); x.strokeRect(19, 31, 8, 3); }
  else if (mood === 'scared') { x.fillStyle = '#5a1e1e'; x.beginPath(); x.ellipse(23, 33, 2.2, 3, 0, 0, TAU); x.fill(); }
  else { x.beginPath(); x.arc(23, 30, 3.5, Math.PI * 0.15, Math.PI * 0.85); x.stroke(); }
  // a glint on the helmet glass
  x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 1.5; x.beginPath(); x.arc(23, 24, 15, Math.PI * 1.15, Math.PI * 1.4); x.stroke();
}

/* Keep the portrait strip in step with the crew aboard and their mood. */
function updateCrewPanel(c, vs) {
  const el = F.hud.crewPanel;
  if (!el) return;
  const crew = (F.crew || []).slice(0, 4);
  el.classList.toggle('hidden', !crew.length);
  if (!crew.length) return;
  const mood = crewMood(c, vs);
  const key = crew.map((x) => x.name).join('|');
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    el.dataset.mood = '';
    el.innerHTML = crew.map((x, i) => {
      const cm = x.id && Career.s && Career.s.crew.find((k) => k.id === x.id);
      const role = cm && isCareer() ? `${ROLES[roleOf(cm)].icon} ` : '';
      return `<div class="portrait" title="${esc(x.name)}"><canvas data-i="${i}"></canvas><span>${role}${esc(x.name.split(' ')[0])}</span></div>`;
    }).join('');
  }
  if (el.dataset.mood === mood) return;
  el.dataset.mood = mood;
  el.querySelectorAll('canvas').forEach((cv) => drawFace(cv, crew[+cv.dataset.i].name, mood));
}
