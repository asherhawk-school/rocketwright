'use strict';
/* Rocketwright — hangar: drag-and-drop rocket builder with attach nodes, symmetry, undo and a staging editor. */

const $ = (id) => document.getElementById(id);
const Hangar = {
  design: newDesign(), name: 'Orbiter I', sel: null, sym: true, showMarkers: true,
  undo: [], redo: [], view: null, a: null, drag: null, hover: null, crewId: null, crewN: 1, site: null,
};

/* ---------------- palette ---------------- */

function partStatsLine(d) {
  const size = d.radial ? 'side' : `${maxWidth(d)} m`;
  if (d.kind === 'engine') return `${d.thrust} kN · Isp ${d.ispSL}/${d.ispVac} s · ${d.mass} t`;
  if (d.kind === 'srb') return `${d.thrust} kN · ${d.solid} t solid · ${size}`;
  if (d.fuel) return `${d.fuel} t fuel · ${(d.mass + d.fuel).toFixed(2)} t · ${size}`;
  if (d.mono) return `${d.mono} t monoprop · ${size}`;
  if (d.torque) return `${d.torque} kN·m torque · ${d.mass} t`;
  return `${d.mass} t · ${size}`;
}

function buildPalette() {
  const pal = $('palette');
  pal.innerHTML = '';
  for (const cat of CATEGORIES) {
    if (cat === 'Science' && !isCareer()) continue;
    if (!Object.keys(PART_DEFS).some((id) => PART_DEFS[id].cat === cat && partUnlocked(id))) continue;
    const h = document.createElement('div');
    h.className = 'cat-title';
    h.textContent = cat;
    pal.appendChild(h);
    for (const id of Object.keys(PART_DEFS)) {
      const d = PART_DEFS[id];
      if (d.cat !== cat || !partUnlocked(id)) continue;
      const b = document.createElement('button');
      b.className = 'part-btn';
      b.title = d.desc;
      const cv = document.createElement('canvas');
      if (gfx3d()) partIcon3d(cv, id, 46, 54); else drawPartIcon(cv, id);
      const txt = document.createElement('div');
      txt.innerHTML = '<div class="pname"></div><div class="pstat"></div>';
      txt.querySelector('.pname').textContent = d.name;
      txt.querySelector('.pstat').textContent = partStatsLine(d) + (isCareer() ? ` · ${fmtFunds(d.cost)}` : '');
      b.append(cv, txt);
      b.addEventListener('pointerdown', (e) => beginPress(e, { kind: 'new', id }));
      pal.appendChild(b);
    }
  }
}

/* ---------------- editing ---------------- */

function snapshot() {
  Hangar.undo.push(JSON.stringify(Hangar.design));
  if (Hangar.undo.length > 80) Hangar.undo.shift();
  Hangar.redo = [];
}
function undo() {
  if (!Hangar.undo.length) return;
  Hangar.redo.push(JSON.stringify(Hangar.design));
  Hangar.design = JSON.parse(Hangar.undo.pop());
  Hangar.sel = null;
  hangarChanged();
}
function redo() {
  if (!Hangar.redo.length) return;
  Hangar.undo.push(JSON.stringify(Hangar.design));
  Hangar.design = JSON.parse(Hangar.redo.pop());
  Hangar.sel = null;
  hangarChanged();
}

function hangarChanged() {
  Store.set('current', { name: Hangar.name, design: Hangar.design });
  Hangar.a = analyzeDesign(Hangar.design);
  if (Hangar.sel != null && !designPart(Hangar.design, Hangar.sel)) Hangar.sel = null;
  drawBuild();
  updateStats();
  // craft on wheels start on the runway unless you pick otherwise
  $('launchSite').value = Hangar.site || (Hangar.design.parts.some((p) => PART_DEFS[p.id].wheel) ? 'runway' : 'pad');
  $('btnUndo').disabled = !Hangar.undo.length;
  $('btnRedo').disabled = !Hangar.redo.length;
}

function removeSel() {
  if (Hangar.sel == null) return;
  snapshot();
  removePartTree(Hangar.design, Hangar.sel);
  Hangar.sel = null;
  hangarChanged();
}

function hint(text) {
  const el = $('buildHint');
  el.textContent = text;
  el.classList.add('flash');
  clearTimeout(hint.t);
  hint.t = setTimeout(() => { el.classList.remove('flash'); el.textContent = DEFAULT_HINT; }, 2600);
}
const DEFAULT_HINT = 'Drag parts onto the rocket · click a part to select · drag it to move · Del removes · Ctrl+Z undoes';

const onCentre = (g) => Math.abs(g.x) < 0.01;

/* Clicking a palette part (without dragging) attaches it somewhere sensible. */
function quickAdd(id) {
  const d = Hangar.design, def = PART_DEFS[id];
  if (!d.parts.length) { snapshot(); Hangar.sel = attachPart(d, id, null)[0]; hangarChanged(); return; }
  const geo = Hangar.a.parts;
  const sel = Hangar.sel != null ? geo.find((g) => g.uid === Hangar.sel) : null;
  let snap = null;
  if (def.radial) {
    let host = sel && (!sel.def.radial || sel.def.radialOut) ? sel : null;
    if (!host) {
      const cands = geo.filter((g) => onCentre(g) && g.def.fuel);
      host = cands.sort((a, b) => a.bot - b.bot)[0] || geo.find((g) => !g.def.radial);
    }
    if (host) {
      const side = host.def.radialOut ? (host.flip ? -1 : 1) : 1;
      const ay = def.fins ? Math.max(0, host.def.h - def.h * 0.75) : Math.max(0, (host.def.h - def.h) / 2);
      snap = { parent: host.uid, node: 'side', side, ay };
    }
  } else if (sel && sel.def.radialOut) {
    snap = { parent: sel.uid, node: 'side', side: sel.flip ? -1 : 1, ay: 0 };
  } else if (def.noTop) {
    const ok = (g) => !g.def.radial && !g.def.noTop && !nodeTaken(d, g.uid, 'top');
    const host = sel && ok(sel) ? sel : geo.filter((g) => onCentre(g) && ok(g)).sort((a, b) => b.top - a.top)[0];
    if (host) snap = { parent: host.uid, node: 'top' };
  } else {
    const freeSlot = (g) => (g.def.slots ? g.def.slots.findIndex((_, i) => !nodeTaken(d, g.uid, 'slot:' + i)) : -1);
    const ok = (g) => !g.def.radial && ((!g.def.noBottom && !nodeTaken(d, g.uid, 'bottom')) || freeSlot(g) >= 0);
    const host = sel && ok(sel) ? sel : geo.filter((g) => onCentre(g) && ok(g)).sort((a, b) => a.bot - b.bot)[0];
    if (host) snap = host.def.slots && freeSlot(host) >= 0 ? { parent: host.uid, node: 'slot:' + freeSlot(host) } : { parent: host.uid, node: 'bottom' };
  }
  if (!snap) { hint('No free spot for that part. Drag it onto the rocket instead.'); return; }
  snapshot();
  const uids = attachPart(d, id, snap.parent, snap.node, snap.side || 0, snap.ay || 0, Hangar.sym);
  Hangar.sel = uids[0];
  hangarChanged();
}

/* Find where a dragged part would attach, given the cursor in craft-local metres. */
function findSnap(id, lx, ly) {
  const d = Hangar.design, def = PART_DEFS[id];
  if (!d.parts.length) return { parent: null };
  const geo = layoutDesign(d);
  const thr = 48 / Hangar.view.s;
  let best = null, bestD = thr;
  const consider = (c, dist) => { if (dist < bestD) { bestD = dist; best = c; } };
  const vOut = (g) => (ly > g.top ? ly - g.top : ly < g.bot ? g.bot - ly : 0);
  const snapAy = (v) => Math.round(v * 10) / 10;
  for (const g of geo) {
    const gd = g.def;
    if (!def.radial) {
      if (!gd.radial) {
        if (!gd.noBottom && !def.noTop && !nodeTaken(d, g.uid, 'bottom'))
          consider({ parent: g.uid, node: 'bottom' }, Math.hypot(lx - g.x, ly + def.h / 2 - g.bot));
        if (!gd.noTop && !nodeTaken(d, g.uid, 'top'))
          consider({ parent: g.uid, node: 'top' }, Math.hypot(lx - g.x, ly - def.h / 2 - g.top));
        // engine mounts: one node per slot
        if (gd.slots && !def.noTop) gd.slots.forEach((sx, i) => {
          if (!nodeTaken(d, g.uid, 'slot:' + i)) consider({ parent: g.uid, node: 'slot:' + i }, Math.hypot(lx - (g.x + sx), ly + def.h / 2 - g.bot));
        });
      }
      if (gd.radialOut) {
        const s = g.flip ? -1 : 1;
        const cx = g.x + s * (gd.w / 2 + maxWidth(def) / 2);
        const ay = clamp(snapAy(g.top - (ly + def.h / 2)), -def.h + 0.3, gd.h - 0.3);
        consider({ parent: g.uid, node: 'side', side: s, ay }, Math.abs(lx - cx) + vOut(g));
      }
    } else {
      if (gd.radial && !gd.radialOut) continue;
      const s = gd.radialOut ? (g.flip ? -1 : 1) : lx >= g.x ? 1 : -1;
      const ay = clamp(snapAy(g.top - (ly + def.h / 2)), -def.h * 0.3, Math.max(0, gd.h - def.h * 0.7));
      const cy = g.top - ay - def.h / 2;
      const cx = g.x + s * (partHalfWidthAt(g, cy) + def.w / 2);
      consider({ parent: g.uid, node: 'side', side: s, ay }, Math.abs(lx - cx) + vOut(g));
    }
  }
  return best;
}

/* Apply a drag (new part or moved subassembly) to design `d` at `snap`. Returns the new root uids. */
function applyDrop(d, drag, snap) {
  if (snap.parent == null) {
    const uids = attachPart(d, drag.id, null);
    if (drag.sub) insertSubtree(d, drag.sub, uids);
    return uids;
  }
  const uids = attachPart(d, drag.id, snap.parent, snap.node, snap.side || 0, snap.ay || 0, Hangar.sym);
  if (drag.sub) insertSubtree(d, drag.sub, uids);
  return uids;
}

/* ---------------- pointer handling ---------------- */

function beginPress(e, info) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  Hangar.press = { ...info, x0: e.clientX, y0: e.clientY, started: false };
}

function startDrag(press) {
  if (press.kind === 'move') {
    const rec = designPart(Hangar.design, press.uid);
    if (!rec || rec.parent == null) return false; // the root part stays put
    snapshot();
    const sub = extractSubtree(Hangar.design, press.uid);
    Hangar.drag = { kind: 'move', id: rec.id, sub, snap: null, lx: 0, ly: 0, saved: Hangar.undo[Hangar.undo.length - 1] };
    Hangar.sel = null;
    Hangar.a = analyzeDesign(Hangar.design);
  } else {
    Hangar.drag = { kind: 'new', id: press.id, sub: null, snap: null, lx: 0, ly: 0 };
  }
  document.body.classList.add('dragging');
  return true;
}

function onPointerMove(e) {
  const p = Hangar.press;
  if (p && !p.started && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 6) {
    p.started = true;
    if (!startDrag(p)) Hangar.press = null;
  }
  const rect = $('buildCanvas').getBoundingClientRect();
  const v = Hangar.view;
  if (!v) return;
  const lx = (e.clientX - rect.left - v.ox) / v.s, ly = (v.oy - (e.clientY - rect.top)) / v.s;
  if (Hangar.drag) {
    const over = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    Hangar.drag.lx = lx; Hangar.drag.ly = ly;
    Hangar.drag.over = over;
    Hangar.drag.snap = over ? findSnap(Hangar.drag.id, lx, ly) : null;
    drawBuild();
  } else if (!p && e.target === $('buildCanvas')) {
    const h = hitPart(lx, ly);
    if (h !== Hangar.hover) { Hangar.hover = h; drawBuild(); }
  }
}

function onPointerUp() {
  const p = Hangar.press, drag = Hangar.drag;
  Hangar.press = null;
  if (drag) {
    Hangar.drag = null;
    document.body.classList.remove('dragging');
    if (drag.snap && drag.over) {
      if (drag.kind === 'new') snapshot();
      const uids = applyDrop(Hangar.design, drag, drag.snap);
      Hangar.sel = uids[0];
    } else if (drag.kind === 'move') {
      Hangar.design = JSON.parse(drag.saved); // dropped nowhere: put it back
      Hangar.undo.pop();
    }
    hangarChanged();
    return;
  }
  if (!p) return;
  if (p.kind === 'new') quickAdd(p.id);
  else if (p.kind === 'move') { Hangar.sel = p.uid; drawBuild(); }
}

function hitPart(lx, ly) {
  const parts = Hangar.a ? Hangar.a.parts : [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const g = parts[i], hw = maxWidth(g.def) / 2 + 0.1;
    if (lx >= g.x - hw && lx <= g.x + hw && ly <= g.top + 0.05 && ly >= g.bot - 0.05) return g.uid;
  }
  return null;
}

function onCanvasDown(e) {
  const v = Hangar.view;
  if (!v) return;
  if (e.button === 2) return; // right button turns the 3D view
  if (hangarRotated()) { R3.hYaw = 0; R3.hPitch = 0; drawBuild(); return; } // editing works from the front
  const rect = e.currentTarget.getBoundingClientRect();
  const lx = (e.clientX - rect.left - v.ox) / v.s, ly = (v.oy - (e.clientY - rect.top)) / v.s;
  const hit = hitPart(lx, ly);
  if (hit == null) { Hangar.sel = null; drawBuild(); return; }
  beginPress(e, { kind: 'move', uid: hit });
}

/* ---------------- drawing ---------------- */

function drawBuild() {
  const cv = $('buildCanvas');
  const box = cv.parentElement.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(50, box.width), H = Math.max(50, box.height);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const g3 = gfx3d(), turned = hangarRotated();
  $('btnTurn').classList.toggle('hidden', !g3);
  ctx.strokeStyle = 'rgba(79,209,255,0.07)';
  ctx.lineWidth = 1;
  for (let x = (W / 2) % 24; x < W; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  const a = Hangar.a;
  const craft = a && a.parts.length ? new Craft(cloneParts(a.parts)) : null;
  // fit the view, but hold it still while dragging so the rocket doesn't jump around
  if (!Hangar.drag || !Hangar.view) {
    let b = craft ? { ...craft.bounds } : { minX: -2, maxX: 2, minY: -6, maxY: 0 };
    if (craft) for (const l of craft.legs) { b.minX = Math.min(b.minX, l.footX - 0.5); b.maxX = Math.max(b.maxX, l.footX + 0.5); b.minY = Math.min(b.minY, l.footY); }
    const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
    const s = Math.min(40, (H - 120) / (bh + 4), (W - 60) / (bw + 8));
    Hangar.view = { s, ox: W / 2 - ((b.minX + b.maxX) / 2) * s, oy: H / 2 + ((b.minY + b.maxY) / 2) * s, W, H };
  }
  const v = Hangar.view;
  if (g3) drawHangar3d(craft, v, W, H);
  ctx.save();
  ctx.setTransform(dpr * v.s, 0, 0, -dpr * v.s, dpr * v.ox, dpr * v.oy);
  const lw = 1 / v.s;
  if (craft && turned) { ctx.restore(); $('selTools').classList.add('hidden'); return; } // overlays only line up from the front
  if (craft) {
    const order = craft.parts.slice().sort((p, q) => (p.def.radial ? 1 : 0) - (q.def.radial ? 1 : 0));
    if (!g3) {
      for (const p of order) drawPart(ctx, p, lw);
      for (const f of craft.shells) drawShell(ctx, f, lw, 0.28);
    }
    const box = (p, col, dash) => {
      const hw = maxWidth(p.def) / 2 + 0.12;
      ctx.strokeStyle = col; ctx.lineWidth = 2 / v.s;
      ctx.setLineDash(dash ? [4 / v.s, 3 / v.s] : []);
      ctx.strokeRect(p.x - hw, p.bot - 0.08, 2 * hw, p.def.h + 0.16);
      ctx.setLineDash([]);
    };
    if (Hangar.hover != null && Hangar.hover !== Hangar.sel && !Hangar.drag) { const p = craft.byUid.get(Hangar.hover); if (p) box(p, 'rgba(255,255,255,0.35)', false); }
    if (Hangar.sel != null) {
      const p = craft.byUid.get(Hangar.sel);
      if (p) {
        box(p, '#4fd1ff', true);
        if (p.sym) for (const q of craft.parts) if (q.sym === p.sym && q !== p) box(q, 'rgba(79,209,255,0.45)', true);
      }
    }
    if (Hangar.showMarkers && !Hangar.drag) {
      // centre of mass
      const r = 0.45;
      ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5 / v.s;
      ctx.beginPath(); ctx.arc(craft.xc, craft.yc, r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.moveTo(craft.xc, craft.yc); ctx.arc(craft.xc, craft.yc, r, 0, Math.PI / 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(craft.xc, craft.yc); ctx.arc(craft.xc, craft.yc, r, Math.PI, Math.PI * 1.5); ctx.fill();
      // centre of thrust (first stage)
      if (a.cot) {
        const [tx, ty] = a.cot;
        ctx.strokeStyle = '#d070ff'; ctx.fillStyle = '#d070ff'; ctx.lineWidth = 3 / v.s;
        ctx.beginPath(); ctx.moveTo(tx, ty - 0.4); ctx.lineTo(tx, ty - 2.2); ctx.stroke();
        poly(ctx, [[tx - 0.4, ty - 2.0], [tx + 0.4, ty - 2.0], [tx, ty - 2.7]]); ctx.fill();
      }
    }
  }
  // ghost of the part being dragged
  const drag = Hangar.drag;
  if (drag && drag.over) {
    ctx.globalAlpha = 0.6;
    if (drag.snap) {
      const tmp = cloneDesign(Hangar.design);
      const before = new Set(tmp.parts.map((p) => p.uid));
      applyDrop(tmp, drag, drag.snap);
      for (const g of layoutDesign(tmp)) if (!before.has(g.uid)) drawPart(ctx, g, lw);
    } else {
      const def = PART_DEFS[drag.id];
      const g = { def, x: drag.lx, top: drag.ly + def.h / 2, bot: drag.ly - def.h / 2, flip: false, fuel: def.fuel || 0, solid: 0, mono: 0 };
      drawPart(ctx, g, lw);
      ctx.globalAlpha = 0.9;
      const hw = maxWidth(def) / 2 + 0.1;
      ctx.strokeStyle = '#ff5d5d'; ctx.lineWidth = 2 / v.s;
      ctx.strokeRect(g.x - hw, g.bot, 2 * hw, def.h);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // selection toolbar
  const tools = $('selTools');
  const sp = craft && Hangar.sel != null && !drag ? craft.byUid.get(Hangar.sel) : null;
  if (sp) {
    tools.classList.remove('hidden');
    $('selName').textContent = sp.def.name + (sp.sym ? ' (×2)' : '');
    if (Hangar.settingsFor !== sp.uid) buildPartSettings(sp);
    const sx = v.ox + (sp.x + maxWidth(sp.def) / 2) * v.s + 14, sy = v.oy - sp.top * v.s;
    tools.style.left = clamp(sx, 4, W - 260) + 'px';
    tools.style.top = clamp(sy, 4, H - tools.offsetHeight - 6) + 'px';
  } else { tools.classList.add('hidden'); Hangar.settingsFor = null; }
}

/* Sliders for the selected part's settings (parachute altitude, thrust limit, fuel load). */
function buildPartSettings(p) {
  Hangar.settingsFor = p.uid;
  const box = $('selSettings');
  box.innerHTML = '';
  const rec = designPart(Hangar.design, p.uid);
  for (const key of partSettingKeys(p.def)) {
    const sd = SETTING_DEFS[key], val = cfgVal(rec || p, key);
    const row = document.createElement('label');
    row.className = 'set-row';
    row.innerHTML = `<span>${sd.label}</span><input type="range" min="${sd.min}" max="${sd.max}" step="${sd.step}" value="${val}"><b>${sd.fmt(val)}</b>`;
    const input = row.querySelector('input'), out = row.querySelector('b');
    input.addEventListener('pointerdown', () => snapshot());
    input.addEventListener('keydown', () => snapshot());
    input.addEventListener('input', () => {
      setPartCfg(Hangar.design, p.uid, key, +input.value);
      out.textContent = sd.fmt(+input.value);
      Store.set('current', { name: Hangar.name, design: Hangar.design });
      Hangar.a = analyzeDesign(Hangar.design);
      drawBuild();
      updateStats();
    });
    box.appendChild(row);
  }
  box.classList.toggle('hidden', !box.children.length);
}

/* ---------------- stats & staging editor ---------------- */

function stageIcon(def) { return def.decoupler ? '⇆' : def.chute ? '☂' : '▲'; }
function chipName(def) {
  if (def.kind === 'decoupler') return 'Decoupler';
  if (def.kind === 'raddec') return def.crossfeed ? 'Crossfeed dec.' : 'Radial dec.';
  if (def.chute) return 'Parachute';
  return shortName(def);
}

/* Put parts into stage `to` (a whole number), or between stages (x.5 makes a new stage there). */
function setStage(uids, to) {
  const a = Hangar.a;
  snapshot();
  const m = {};
  a.stages.forEach((s, i) => { for (const u of s) m[u] = i; });
  for (const u of uids) m[u] = to;
  Hangar.design.stageOf = normalizeStages(m);
  hangarChanged();
}
function moveStage(uids, delta) {
  const a = Hangar.a;
  const cur = a.stages.findIndex((s) => s.includes(uids[0]));
  setStage(uids, cur + delta);
}

/* A thin drop target between stage cards: dropping a part there makes a new stage. */
function stageGap(where) {
  const g = document.createElement('div');
  g.className = 'stage-gap';
  g.textContent = 'New stage here';
  g.addEventListener('dragover', (e) => { e.preventDefault(); g.classList.add('over'); });
  g.addEventListener('dragleave', () => g.classList.remove('over'));
  g.addEventListener('drop', (e) => { e.preventDefault(); const u = JSON.parse(e.dataTransfer.getData('text/plain')); setStage(u, where); });
  return g;
}

function updateStats() {
  const a = Hangar.a || analyzeDesign(Hangar.design);
  const count = Hangar.design.parts.length;
  $('statSummary').innerHTML = `
    <div class="kv"><span>Mass</span><b>${fmtNum(a.mass, 2)} t</b></div>
    <div class="kv"><span>Height × width</span><b>${fmtNum(a.height, 1)} × ${fmtNum(a.width, 1)} m</b></div>
    <div class="kv"><span>Parts</span><b>${count}</b></div>
    ${isCareer() ? `<div class="kv"><span>Cost</span><b>${fmtFunds(designCost(Hangar.design))}</b></div>` : ''}
    <div class="kv big-kv"><span>Total Δv (vacuum)</span><b>${fmtNum(a.total)} m/s</b></div>`;
  const list = $('stageList');
  list.innerHTML = '';
  const byUid = new Map(a.parts.map((p) => [p.uid, p]));
  if (a.stages.length) list.appendChild(stageGap(-0.5));
  a.stages.forEach((uids, i) => {
    const r = a.rows[i];
    const card = document.createElement('div');
    card.className = 'stage-row';
    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('over'); });
    card.addEventListener('dragleave', () => card.classList.remove('over'));
    card.addEventListener('drop', (e) => { e.preventDefault(); setStage(JSON.parse(e.dataTransfer.getData('text/plain')), i); });
    const head = document.createElement('div');
    head.className = 'stage-label';
    head.textContent = `Stage ${i + 1}`;
    card.appendChild(head);
    if (r && r.dv > 0.5) {
      const s = document.createElement('div');
      s.className = 'stage-stats';
      s.textContent = `Δv ${fmtNum(r.dv)} m/s · TWR ${r.twr.toFixed(2)} (vac ${r.twrVac.toFixed(2)}) · ${fmtNum(r.burn)} s`;
      card.appendChild(s);
    }
    // one chip per part, or per mirrored pair
    const groups = new Map();
    for (const u of uids) {
      const p = byUid.get(u);
      if (!p) continue;
      const key = p.sym ? 's' + p.sym : 'u' + u;
      if (!groups.has(key)) groups.set(key, { p, uids: [] });
      groups.get(key).uids.push(u);
    }
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const { p, uids: gu } of groups.values()) {
      const chip = document.createElement('div');
      chip.className = 'chip' + (gu.includes(Hangar.sel) ? ' sel' : '');
      chip.draggable = true;
      chip.title = 'Drag to another stage, or between stages to make a new one';
      chip.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify(gu)); list.classList.add('dragging-stage'); });
      chip.addEventListener('dragend', () => list.classList.remove('dragging-stage'));
      const label = document.createElement('span');
      label.textContent = `${stageIcon(p.def)} ${chipName(p.def)}${gu.length > 1 ? ' ×' + gu.length : ''}`;
      label.title = p.def.name;
      label.addEventListener('click', () => { Hangar.sel = gu[0]; drawBuild(); updateStats(); });
      const up = document.createElement('button');
      up.textContent = '▲'; up.title = 'Fire earlier';
      up.addEventListener('click', () => moveStage(gu, -1));
      const dn = document.createElement('button');
      dn.textContent = '▼'; dn.title = 'Fire later';
      dn.addEventListener('click', () => moveStage(gu, 1));
      const split = document.createElement('button');
      split.textContent = '✂'; split.title = 'Give it a stage of its own, right after this one';
      split.addEventListener('click', () => setStage(gu, i + 0.5));
      chip.append(label, up, dn);
      if (groups.size > 1) chip.append(split);
      chips.appendChild(chip);
    }
    card.appendChild(chips);
    list.appendChild(card);
    list.appendChild(stageGap(i + 0.5));
  });
  if (!a.stages.length) list.innerHTML = '<div class="muted">No stages yet.</div>';
  $('btnAutoStage').classList.toggle('hidden', !Hangar.design.stageOf);
  const w = $('warnings');
  w.innerHTML = '';
  for (const x of a.warnings) {
    const d = document.createElement('div');
    d.className = 'warn ' + x.lvl;
    d.textContent = x.text;
    w.appendChild(d);
  }
  let ok = a.valid;
  const career = isCareer();
  $('crewRow').classList.add('hidden');
  if (career) {
    const s = Career.s, cost = designCost(Hangar.design), locked = lockedParts(Hangar.design);
    const extra = [];
    if (locked.length) extra.push({ lvl: 'err', text: `Uses parts you haven't researched: ${locked.map((id) => PART_DEFS[id].name).join(', ')}.` });
    if (cost > s.funds) extra.push({ lvl: 'err', text: `This rocket costs ${fmtFunds(cost)} but you have ${fmtFunds(s.funds)}.` });
    const seats = designSeats(Hangar.design);
    if (seats > 0) {
      const av = availableCrew(s).sort((x, y) => crewRank(y) - crewRank(x));
      if (!av.length) extra.push({ lvl: 'err', text: 'No astronauts available. Hire one in the Astronaut Office.' });
      else {
        if (!av.some((c) => c.id === Hangar.crewId)) Hangar.crewId = av[0].id;
        const sel = $('crewSelect');
        sel.innerHTML = av.map((c) => `<option value="${c.id}" ${c.id === Hangar.crewId ? 'selected' : ''}>${c.name} ${'★'.repeat(crewRank(c))}</option>`).join('');
        const most = Math.min(seats, av.length);
        Hangar.crewN = clamp(Hangar.crewN || 1, 1, most);
        const cnt = $('crewCount');
        cnt.innerHTML = Array.from({ length: most }, (_, i) => `<option value="${i + 1}" ${i + 1 === Hangar.crewN ? 'selected' : ''}>${i + 1} aboard</option>`).join('');
        cnt.classList.toggle('hidden', most < 2);
        $('crewRow').classList.remove('hidden');
      }
    }
    for (const x of extra) {
      const d = document.createElement('div');
      d.className = 'warn ' + x.lvl;
      d.textContent = x.text;
      w.prepend(d);
      ok = false;
    }
    $('btnLaunch').textContent = `LAUNCH · ${fmtFunds(cost)}`;
  } else $('btnLaunch').textContent = 'LAUNCH';
  $('btnLaunch').disabled = !ok;
}

/* ---------------- load / save ---------------- */

function fillLoadSelect() {
  const s = $('loadSelect');
  s.innerHTML = '<option value="">Load a craft…</option>';
  const g1 = document.createElement('optgroup');
  g1.label = 'Example crafts';
  for (const n of Object.keys(PRESETS)) { const o = document.createElement('option'); o.value = 'p:' + n; o.textContent = n; g1.appendChild(o); }
  s.appendChild(g1);
  const saved = Store.get('saved', {});
  const names = Object.keys(saved);
  if (names.length) {
    const g2 = document.createElement('optgroup');
    g2.label = 'Your saved crafts';
    for (const n of names) { const o = document.createElement('option'); o.value = 's:' + n; o.textContent = n; g2.appendChild(o); }
    s.appendChild(g2);
  }
}

function loadCraft(name, design, keepUndo) {
  Hangar.site = null;
  if (keepUndo) snapshot();
  Hangar.name = name;
  Hangar.design = migrateDesign(design);
  Hangar.sel = null;
  $('craftName').value = name;
  hangarChanged();
}

function setSymmetry(on) {
  Hangar.sym = on;
  $('btnSym').textContent = on ? 'Symmetry: 2×' : 'Symmetry: 1×';
  $('btnSym').classList.toggle('on', on);
}

function wireHangar() {
  $('buildCanvas').addEventListener('pointerdown', onCanvasDown);
  // turn the rocket around in 3D: drag with the right mouse button, or press Turn
  let turn = null;
  $('buildCanvas').addEventListener('contextmenu', (e) => { if (gfx3d()) e.preventDefault(); });
  $('buildCanvas').addEventListener('pointerdown', (e) => { if (gfx3d() && e.button === 2) turn = { x: e.clientX, y: e.clientY, yaw: R3.hYaw, pitch: R3.hPitch }; });
  window.addEventListener('pointermove', (e) => {
    if (!turn) return;
    R3.hYaw = turn.yaw - (e.clientX - turn.x) * 0.01;
    R3.hPitch = clamp(turn.pitch + (e.clientY - turn.y) * 0.01, -1.2, 1.2);
    drawBuild();
  });
  window.addEventListener('pointerup', () => { turn = null; });
  $('btnTurn').addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (hangarRotated()) { R3.hYaw = 0; R3.hPitch = 0; drawBuild(); return; }
    const t0 = performance.now();
    const spin = (now) => {
      const k = Math.min(1, (now - t0) / 3200);
      R3.hYaw = TAU * (k - Math.sin(k * TAU) / TAU) ; R3.hPitch = 0.25 * Math.sin(k * Math.PI);
      if (k >= 1) { R3.hYaw = 0; R3.hPitch = 0; }
      drawBuild();
      if (k < 1 && $('hangar').offsetParent !== null) requestAnimationFrame(spin);
    };
    requestAnimationFrame(spin);
  });
  $('buildCanvas').addEventListener('pointerleave', () => { if (Hangar.hover != null) { Hangar.hover = null; drawBuild(); } });
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  $('selDel').addEventListener('click', removeSel);
  $('crewSelect').addEventListener('change', (e) => { Hangar.crewId = +e.target.value; });
  $('crewCount').addEventListener('change', (e) => { Hangar.crewN = +e.target.value; });
  $('launchSite').addEventListener('change', (e) => { Hangar.site = e.target.value; e.target.blur(); });
  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);
  $('btnSym').addEventListener('click', () => setSymmetry(!Hangar.sym));
  $('btnMarkers').addEventListener('click', () => { Hangar.showMarkers = !Hangar.showMarkers; $('btnMarkers').classList.toggle('on', Hangar.showMarkers); drawBuild(); });
  $('btnAutoStage').addEventListener('click', () => { snapshot(); Hangar.design.stageOf = null; hangarChanged(); });
  $('craftName').addEventListener('input', (e) => { Hangar.name = e.target.value.trim() || 'Untitled'; Store.set('current', { name: Hangar.name, design: Hangar.design }); });
  $('btnSave').addEventListener('click', () => {
    const saved = Store.get('saved', {});
    saved[Hangar.name] = cloneDesign(Hangar.design);
    Store.set('saved', saved);
    fillLoadSelect();
    const b = $('btnSave'); b.textContent = 'Saved ✓'; setTimeout(() => { b.textContent = 'Save'; }, 1200);
  });
  $('btnClear').addEventListener('click', () => { snapshot(); Hangar.design = newDesign(); Hangar.sel = null; hangarChanged(); });
  $('loadSelect').addEventListener('change', (e) => {
    const v = e.target.value;
    if (!v) return;
    const name = v.slice(2);
    if (v[0] === 'p') loadCraft(name, PRESETS[name](), true);
    else loadCraft(name, Store.get('saved', {})[name] || [], true);
    e.target.value = '';
  });
  setSymmetry(true);
}

function hangarKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  else if (mod && e.code === 'KeyY') { e.preventDefault(); redo(); }
  else if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); removeSel(); }
  else if (e.code === 'Escape') { Hangar.sel = null; drawBuild(); }
  else if (e.code === 'KeyX' && !mod) setSymmetry(!Hangar.sym);
}
