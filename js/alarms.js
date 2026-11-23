'use strict';
/* Rocketwright — the alarm clock. Alarms are kept in the save game. Time warp stops exactly when one goes off,
   in flight and when waiting at the Tracking Station. Set them from the alarm panel (C): before a manoeuvre burn,
   at apoapsis or periapsis, before the next change of sphere of influence, or after a set time. */

function alarmList() {
  const s = Career.s;
  if (!s) return [];
  return s.alarms || (s.alarms = []);
}
function addAlarm(t, text, vid) {
  const s = Career.s;
  if (!s) return null;
  s.alarmSeq = (s.alarmSeq || 0) + 1;
  const a = { id: s.alarmSeq, t, text, vid: vid == null ? null : vid };
  const list = alarmList();
  list.push(a);
  list.sort((x, y) => x.t - y.t);
  if (typeof persist === 'function') persist();
  return a;
}
function removeAlarm(id) {
  const s = Career.s;
  if (!s || !s.alarms) return;
  s.alarms = s.alarms.filter((a) => a.id !== id);
}
/* The first alarm after time t. */
function nextAlarm(t) { return alarmList().find((a) => a.t > t) || null; }
/* Shorten a time step from t so it ends exactly at the next alarm, if one falls inside it. */
function alarmClip(t, dt) {
  const a = alarmList().find((x) => x.t > t && x.t <= t + dt);
  return a ? { dt: a.t - t, a } : { dt, a: null };
}

/* In flight: stop time warp and tell the player. */
function ringAlarm(a) {
  removeAlarm(a.id);
  F.warp = 0;
  F.acc = 0;
  const other = a.vid != null && a.vid !== F.vid;
  if (typeof playSound === 'function') playSound('dock');
  flash(`⏰ ${a.text}${other ? ' (another vessel: switch to it from the Tracking Station)' : ''}`, 6);
  if (typeof toast === 'function') toast(`⏰ ${a.text}`);
  F.alarmSig = '';
}
/* Anything due (after physics steps, which aren't clipped)? */
function checkAlarms() {
  for (const a of alarmList().slice()) if (a.t <= F.t) ringAlarm(a);
}

/* ---------------- the alarm panel ---------------- */

/* The alarms you can add right now, as [label, time, text]. */
function alarmPresets() {
  const c = F.craft, out = [], name = F.craftName;
  if (!c || c.dead) return out;
  if (F.node && !F.node.frozen) {
    const bt = burnTime(c, Math.hypot(F.node.pro, F.node.rad));
    out.push(['Manoeuvre', F.node.t - (isFinite(bt) ? bt / 2 : 0) - 60, `${name}: manoeuvre burn in 1 minute`]);
  }
  const o = F.orbit;
  if (o && !c.landed) {
    if (o.e < 1 && isFinite(o.tAp)) out.push(['Apoapsis', F.t + o.tAp - 30, `${name}: 30 s to apoapsis`]);
    if (isFinite(o.tPe) && o.tPe > 0) out.push(['Periapsis', F.t + o.tPe - 30, `${name}: 30 s to periapsis`]);
  }
  const ev = F.encounter && F.encounter.find((e) => e.kind === 'enc' || e.kind === 'exit');
  if (ev) out.push([ev.kind === 'enc' ? `Reach ${ev.body.name}` : `Leave ${ev.body.name}`, ev.t - 120,
    `${name}: ${ev.kind === 'enc' ? `entering ${ev.body.name}'s sphere of influence` : `leaving ${ev.body.name}`} in 2 minutes`]);
  for (const [label, dt] of [['+1 hour', 3600], ['+6 hours', 21600], ['+1 day', 86400]]) out.push([label, F.t + dt, `${name}: ${label.slice(1)} alarm`]);
  return out.filter((p) => p[1] > F.t + 1);
}

function toggleAlarms() {
  if (!Career.s) return;
  F.alarmOpen = !F.alarmOpen;
  F.hud.alarmPanel.classList.toggle('hidden', !F.alarmOpen);
  F.alarmSig = '';
  if (F.alarmOpen) renderAlarmPanel();
}

/* Rebuilt only when its buttons change, so clicks are never lost. */
function renderAlarmPanel() {
  if (!F.alarmOpen) return;
  const el = F.hud.alarmList, presets = alarmPresets(), list = alarmList();
  const sig = presets.map((p) => p[0]).join('|') + '#' + list.map((a) => a.id).join(',');
  if (sig !== F.alarmSig) {
    F.alarmSig = sig;
    el.innerHTML = `<div class="alarm-add">${presets.map((p, i) => `<button data-al="${i}" title="${p[2].replace(/"/g, '')}">${p[0]}</button>`).join('')}</div>` +
      (list.length ? list.map((a) => `<div class="alarm-row" data-id="${a.id}"><span class="al-text"></span><b class="al-left"></b><button data-alx="${a.id}" title="Delete">✕</button></div>`).join('')
        : '<div class="muted">No alarms set.</div>');
    F.alarmPresetCache = presets;
  }
  for (const a of list) {
    const row = el.querySelector(`[data-id="${a.id}"]`);
    if (!row) continue;
    const txt = a.text + (a.vid != null && a.vid !== F.vid ? ' ·' : '');
    if (row.querySelector('.al-text').textContent !== txt) row.querySelector('.al-text').textContent = txt;
    row.querySelector('.al-left').textContent = fmtDur(Math.max(0, a.t - F.t));
  }
}
function alarmClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.al !== undefined) {
    const p = (F.alarmPresetCache || [])[+b.dataset.al];
    if (p) { addAlarm(p[1], p[2], F.vid); flash(`Alarm set: ${p[0]}`, 2); }
  } else if (b.dataset.alx !== undefined) removeAlarm(+b.dataset.alx);
  F.alarmSig = '';
  renderAlarmPanel();
}
