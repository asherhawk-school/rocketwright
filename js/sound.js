'use strict';
/* Rocketwright — sound, all synthesised with WebAudio (no audio files). Browsers only allow audio after the
   player interacts, so initSound() runs on the first click or key press. */

const Sound = { ctx: null, master: null, vol: 0.6, loops: null };

function initSound() {
  if (Sound.ctx) { if (Sound.ctx.state === 'suspended') Sound.ctx.resume(); return; }
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return;
  const ctx = (Sound.ctx = new AC());
  Sound.vol = Store.get('volume', 0.6);
  Sound.master = ctx.createGain();
  Sound.master.gain.value = Sound.vol;
  Sound.master.connect(ctx.destination);
  // two seconds of brown-ish noise, shared by every sound
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04; d[i] = last * 3.5; }
  Sound.noise = buf;
  const loop = (type, freq, q) => {
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(Sound.master); src.start();
    return { f, g };
  };
  Sound.loops = { engine: loop('lowpass', 220, 0.8), crackle: loop('bandpass', 1400, 1.5), wind: loop('bandpass', 700, 0.6) };
}

function setVolume(v) {
  Sound.vol = clamp(v, 0, 1);
  Store.set('volume', Sound.vol);
  if (Sound.master) Sound.master.gain.value = Sound.vol;
}

/* Called every frame while flying: engine rumble with thrust (quieter in thin air), solid-rocket crackle, wind. */
function updateSound(c, pressure, q, active) {
  if (!Sound.loops) return;
  const t = Sound.ctx.currentTime, L = Sound.loops;
  const set = (node, v) => node.gain.setTargetAtTime(v, t, 0.08);
  if (!active || !c || c.dead) { set(L.engine.g, 0); set(L.crackle.g, 0); set(L.wind.g, 0); return; }
  const thrust = Math.abs(c.thrust || 0);
  const air = 0.15 + 0.85 * clamp(pressure, 0, 1);
  set(L.engine.g, Math.min(0.9, Math.sqrt(thrust / 300)) * 0.55 * air);
  L.engine.f.frequency.setTargetAtTime(140 + 260 * clamp(c.throttle, 0, 1), t, 0.1);
  const solid = c.engines.some((e) => e.def.solid && e.burn > 0);
  set(L.crackle.g, solid ? 0.18 * air : 0);
  set(L.wind.g, Math.min(0.35, q / 30));
  L.wind.f.frequency.setTargetAtTime(400 + Math.min(1600, q * 40), t, 0.2);
}

/* One-off sounds: 'stage', 'boom', 'chute', 'dock', 'click'. */
function playSound(kind) {
  if (!Sound.ctx || !Sound.noise) return;
  const ctx = Sound.ctx, t = ctx.currentTime;
  const burst = (type, freq, dur, vol, sweepTo) => {
    const src = ctx.createBufferSource(); src.buffer = Sound.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(Sound.master); src.start(t, Math.random()); src.stop(t + dur + 0.05);
  };
  const tone = (freq, dur, vol, type = 'sine') => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(Sound.master); o.start(t); o.stop(t + dur + 0.05);
  };
  if (kind === 'stage') { burst('highpass', 900, 0.25, 0.7); tone(90, 0.2, 0.5); }
  else if (kind === 'boom') { burst('lowpass', 500, 1.6, 1.2, 60); tone(55, 1.2, 0.8); }
  else if (kind === 'chute') burst('bandpass', 300, 0.7, 0.6, 1500);
  else if (kind === 'dock') { tone(700, 0.08, 0.4, 'square'); setTimeout(() => playSound('click'), 120); }
  else if (kind === 'click') tone(1100, 0.05, 0.25, 'square');
}
