'use strict';
/* Rocketwright — craft model: a tree of parts joined by stack nodes (top/bottom) and side attachment.

   Design (what the hangar edits and saves):
     { v: 2, parts: [{ uid, id, parent, node: 'top'|'bottom'|'side'|null, side: ±1, ay, sym }], nextUid, stageOf }
     - node 'side': the part sits beside its parent; `ay` is how far below the parent's top its own top is.
     - `sym` groups mirrored copies; `stageOf` maps uid -> stage number (null = automatic staging).
   Layout turns a design into "geo parts" with local coordinates (x lateral, y up, root top at 0),
   which are also the live parts a Craft flies with. */

const isEngine = (def) => !!def.thrust && !def.rcs;
const maxWidth = (def) => Math.max(def.w, def.wb !== undefined ? def.wb : def.w);
const activatable = (def) => !!(def.decoupler || isEngine(def) || def.chute);

/* ---------------- design editing ---------------- */

function newDesign() { return { v: 2, parts: [], nextUid: 1, stageOf: null }; }
function cloneDesign(d) { return JSON.parse(JSON.stringify(d)); }
function designPart(d, uid) { return d.parts.find((p) => p.uid === uid); }
function nodeTaken(d, uid, node) { return d.parts.some((p) => p.parent === uid && p.node === node); }

/* Attach a new part. Children of a mirrored part are copied onto its counterpart; side parts on the
   centreline get a mirrored twin when `symmetry` is on. Returns the new uids. */
function attachPart(d, id, parentUid, node, side, ay, symmetry) {
  const parent = parentUid == null ? null : designPart(d, parentUid);
  const mk = (host, s, nd = node) => {
    const uid = d.nextUid++;
    d.parts.push({ uid, id, parent: host ? host.uid : null, node: host ? nd : null, side: s, ay: ay || 0, sym: null });
    return uid;
  };
  if (!parent) return [mk(null, 0)];
  const hosts = parent.sym ? d.parts.filter((p) => p.sym === parent.sym) : [parent];
  const uids = [];
  // the slot on the other side of a mount, if there is one
  const slot = node && node.startsWith('slot:') ? +node.slice(5) : -1;
  const slots = PART_DEFS[parent.id].slots || [];
  const mirrorSlot = slot < 0 ? -1 : slots.findIndex((x, i) => i !== slot && Math.abs(x + slots[slot]) < 1e-6);
  if (hosts.length > 1) {
    for (const h of hosts) {
      const nd = slot >= 0 && h !== parent && mirrorSlot >= 0 ? 'slot:' + mirrorSlot : node;
      uids.push(mk(h, node === 'side' ? (h === parent ? side : -side) : 0, nd));
    }
  } else if (slot >= 0 && symmetry && mirrorSlot >= 0 && !nodeTaken(d, parent.uid, 'slot:' + mirrorSlot)) {
    uids.push(mk(parent, 0), mk(parent, 0, 'slot:' + mirrorSlot));
  } else if (node === 'side' && symmetry) {
    uids.push(mk(parent, side), mk(parent, -side));
  } else {
    uids.push(mk(parent, node === 'side' ? side : 0));
  }
  if (uids.length > 1) {
    const g = d.nextUid++;
    for (const u of uids) designPart(d, u).sym = g;
  }
  return uids;
}

function subtreeUids(d, uid) {
  const out = [uid];
  for (let i = 0; i < out.length; i++) for (const p of d.parts) if (p.parent === out[i]) out.push(p.uid);
  return out;
}

/* Remove a part, everything attached below it, and its mirrored counterparts. */
function removePartTree(d, uid) {
  const p = designPart(d, uid);
  if (!p) return;
  const roots = p.sym ? d.parts.filter((q) => q.sym === p.sym).map((q) => q.uid) : [uid];
  const kill = new Set();
  for (const r of roots) for (const u of subtreeUids(d, r)) kill.add(u);
  d.parts = d.parts.filter((q) => !kill.has(q.uid));
  if (d.stageOf) for (const u of kill) delete d.stageOf[u];
}

/* Change a part's setting; mirrored twins follow. */
function setPartCfg(d, uid, key, value) {
  const p = designPart(d, uid);
  if (!p) return;
  const all = p.sym ? d.parts.filter((q) => q.sym === p.sym) : [p];
  for (const q of all) { q.cfg = { ...(q.cfg || {}) }; q.cfg[key] = value; }
}

/* Detach a part's subtree as plain records (for moving it); counterparts are deleted. */
function extractSubtree(d, uid) {
  const p = designPart(d, uid);
  const recs = subtreeUids(d, uid).map((u) => ({ ...designPart(d, u) }));
  removePartTree(d, uid);
  return { recs, rootUid: uid, rootSide: p.side || 0 };
}

/* Re-insert an extracted subtree under each of `newRoots` (uids already created for the root part). */
function insertSubtree(d, sub, newRoots) {
  for (const nr of newRoots) {
    const mirror = (designPart(d, nr).side || 0) !== sub.rootSide && sub.rootSide !== 0;
    const map = new Map([[sub.rootUid, nr]]);
    for (const r of sub.recs) {
      if (r.uid === sub.rootUid) continue;
      const uid = d.nextUid++;
      map.set(r.uid, uid);
      d.parts.push({ uid, id: r.id, parent: null, node: r.node, side: mirror ? -r.side : r.side, ay: r.ay, sym: null, _p: r.parent });
    }
    for (const p of d.parts) if (p._p !== undefined) { p.parent = map.get(p._p); delete p._p; }
  }
}

/* Old saves were a flat top-to-bottom list of ids; fins and legs were stack parts back then. */
function designFromStack(ids) {
  const d = newDesign();
  let prev = null;
  for (const id of ids) {
    const def = PART_DEFS[id];
    if (!def) continue;
    if (def.radial) {
      if (prev === null) continue;
      const hd = PART_DEFS[designPart(d, prev).id];
      const ay = def.fins ? Math.max(0, hd.h - def.h * 0.75) : Math.max(0, hd.h - def.h);
      attachPart(d, id, prev, 'side', 1, ay, true);
      continue;
    }
    prev = attachPart(d, id, prev, prev === null ? null : 'bottom', 0, 0, false)[0];
  }
  return d;
}

function migrateDesign(x) {
  if (Array.isArray(x)) return designFromStack(x);
  if (x && x.v === 2 && Array.isArray(x.parts)) {
    x.parts = x.parts.filter((p) => PART_DEFS[p.id]);
    return x;
  }
  return newDesign();
}

/* ---------------- layout ---------------- */

function partHalfWidthAt(g, y) {
  const wt = g.def.w, wb = g.def.wb !== undefined ? g.def.wb : g.def.w;
  return lerp(wt, wb, clamp((g.top - y) / g.def.h, 0, 1)) / 2;
}

function makeGeo(rec, x, top, flip, parentUid) {
  const def = PART_DEFS[rec.id];
  const fill = rec.cfg && rec.cfg.fill !== undefined ? rec.cfg.fill / 100 : 1;
  return {
    cfg: rec.cfg ? { ...rec.cfg } : {},
    uid: rec.uid, id: rec.id, def, x, top, bot: top - def.h, flip, parent: parentUid, node: rec.node,
    side: rec.side || 0, sym: rec.sym || null, links: [], inv: false,
    fuel: (def.fuel || 0) * fill, solid: def.solid || 0, mono: (def.mono || 0) * fill, ec: def.ec || 0, ablator: def.ablator || 0, temp: 290,
    ignited: false, burn: 0, m: 0,
  };
}

function placeChild(k, pg) {
  const def = PART_DEFS[k.id];
  if (k.node === 'bottom') return makeGeo(k, pg.x, pg.bot, false, pg.uid);
  if (k.node && k.node.startsWith('slot:')) return makeGeo(k, pg.x + ((pg.def.slots || [])[+k.node.slice(5)] || 0), pg.bot, false, pg.uid);
  if (k.node === 'top') return makeGeo(k, pg.x, pg.top + def.h, false, pg.uid);
  const s = k.side || 1, top = pg.top - (k.ay || 0), cy = top - def.h / 2;
  if (def.radial) return makeGeo(k, pg.x + s * (partHalfWidthAt(pg, cy) + def.w / 2), top, s < 0, pg.uid);
  return makeGeo(k, pg.x + s * (pg.def.w / 2 + maxWidth(def) / 2), top, false, pg.uid);
}

function layoutDesign(d) {
  const kids = new Map();
  for (const p of d.parts) if (p.parent != null) {
    if (!kids.has(p.parent)) kids.set(p.parent, []);
    kids.get(p.parent).push(p);
  }
  const root = d.parts.find((p) => p.parent == null);
  const out = [];
  if (!root) return out;
  const place = (rec, g) => {
    out.push(g);
    for (const k of kids.get(rec.uid) || []) {
      const kg = placeChild(k, g);
      g.links.push(kg.uid);
      kg.links.push(g.uid);
      place(k, kg);
    }
  };
  place(root, makeGeo(root, 0, 0, false, null));
  return out;
}

/* ---------------- structure helpers ---------------- */

/* Fuel groups: parts connected without crossing a (non-crossfeed) decoupler share fuel. */
function computeGroups(parts) {
  const id = new Map(parts.map((p) => [p.uid, p.uid]));
  const find = (u) => { while (id.get(u) !== u) { id.set(u, id.get(id.get(u))); u = id.get(u); } return u; };
  const by = new Map(parts.map((p) => [p.uid, p]));
  const blocks = (p) => p.def.decoupler && !p.def.crossfeed;
  for (const p of parts) {
    if (blocks(p)) continue;
    for (const l of p.links) {
      const q = by.get(l);
      if (!q || blocks(q)) continue;
      id.set(find(p.uid), find(q.uid));
    }
  }
  const g = new Map();
  for (const p of parts) g.set(p.uid, find(p.uid));
  return g;
}

function components(parts) {
  const set = new Map(parts.map((p) => [p.uid, p]));
  const seen = new Set(), out = [];
  for (const p of parts) {
    if (seen.has(p.uid)) continue;
    const comp = [], q = [p];
    seen.add(p.uid);
    while (q.length) {
      const c = q.pop();
      comp.push(c);
      for (const l of c.links) if (set.has(l) && !seen.has(l)) { seen.add(l); q.push(set.get(l)); }
    }
    out.push(comp);
  }
  return out;
}

/* The part that commands the craft: a capsule if there is one, else a probe core. */
function rootUidOf(parts) {
  const cmd = parts.find((p) => p.def.pod) || parts.find((p) => p.def.probe);
  return cmd ? cmd.uid : parts[0].uid;
}

/* Automatic staging. Decouplers deeper in the tree (counted from the capsule) fire first; an engine
   ignites together with the shallowest decoupler below it, or at launch if nothing is below it;
   parachutes come last. */
function autoStages(parts) {
  if (!parts.length) return {};
  const root = rootUidOf(parts);
  const by = new Map(parts.map((p) => [p.uid, p]));
  const parent = new Map([[root, null]]), order = [root];
  for (let i = 0; i < order.length; i++) {
    for (const l of by.get(order[i]).links) if (by.has(l) && !parent.has(l)) { parent.set(l, order[i]); order.push(l); }
  }
  const depth = new Map();
  for (const u of order) {
    const pu = parent.get(u);
    depth.set(u, (pu == null ? 0 : depth.get(pu)) + (by.get(u).def.decoupler ? 1 : 0));
  }
  const minBelow = new Map();
  for (let i = order.length - 1; i >= 0; i--) {
    const u = order[i], pu = parent.get(u);
    const own = by.get(u).def.decoupler ? depth.get(u) : Infinity;
    const val = Math.min(minBelow.has(u) ? minBelow.get(u) : Infinity, own);
    if (pu != null) minBelow.set(pu, Math.min(minBelow.has(pu) ? minBelow.get(pu) : Infinity, val));
  }
  const below = (u) => (minBelow.has(u) ? minBelow.get(u) : Infinity);
  const decDepths = [...new Set(parts.filter((p) => p.def.decoupler && depth.has(p.uid)).map((p) => depth.get(p.uid)))].sort((a, b) => b - a);
  const base = parts.some((p) => isEngine(p.def) && !isFinite(below(p.uid))) ? 1 : 0;
  const stageOfDepth = new Map(decDepths.map((dd, i) => [dd, base + i]));
  const out = {};
  for (const p of parts) {
    if (p.def.decoupler && depth.has(p.uid)) out[p.uid] = stageOfDepth.get(depth.get(p.uid));
    else if (isEngine(p.def)) out[p.uid] = isFinite(below(p.uid)) ? stageOfDepth.get(below(p.uid)) : 0;
  }
  for (const p of parts) if (p.def.chute) out[p.uid] = base + decDepths.length;
  return normalizeStages(out);
}

function normalizeStages(m) {
  const vals = [...new Set(Object.values(m))].sort((a, b) => a - b);
  const idx = new Map(vals.map((v, i) => [v, i]));
  for (const k in m) m[k] = idx.get(m[k]);
  return m;
}

/* Merge the design's manual staging (if any) with automatic staging for parts it doesn't cover. */
function resolveStages(d, parts) {
  const auto = autoStages(parts);
  if (!d.stageOf) return auto;
  const m = {};
  for (const p of parts) if (activatable(p.def)) m[p.uid] = d.stageOf[p.uid] !== undefined ? d.stageOf[p.uid] : (auto[p.uid] || 0);
  normalizeStages(m);
  d.stageOf = m;
  return m;
}

function stageListFrom(m) {
  const L = [];
  for (const k in m) { (L[m[k]] || (L[m[k]] = [])).push(+k); }
  return L.filter((s) => s && s.length);
}

function shortName(def) { return def.name.split(' ')[0]; }
function stageLabel(uids, lookup) {
  const sep = [], ign = new Map();
  let chute = false;
  for (const u of uids) {
    const p = lookup(u);
    if (!p) continue;
    if (p.def.decoupler) sep.push(p);
    else if (isEngine(p.def)) ign.set(shortName(p.def), (ign.get(shortName(p.def)) || 0) + 1);
    else if (p.def.chute) chute = true;
  }
  const bits = [];
  if (sep.length) bits.push(sep.length > 1 ? `Separate ×${sep.length}` : 'Separate');
  if (ign.size) bits.push('Ignite ' + [...ign].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(', '));
  if (chute) bits.push('Parachute');
  return bits.join(' · ') || 'Empty stage';
}

/* ---------------- craft ---------------- */

function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

class Craft {
  constructor(parts, opts = {}) {
    this.parts = parts;
    this.stages = opts.stages || [];
    this.stageIdx = 0;
    this.pos = [0, 0];
    this.vel = [0, 0];
    this.angle = Math.PI / 2; // direction the nose points (world radians)
    this.angVel = 0;
    this.throttle = 0;
    this.ctrl = 0;
    this.landed = null;
    this.dead = false;
    this.chuteOpen = false;
    this.chuteArea = 0;
    this.gimbalCap = 0;
    this.thrust = 0;
    this.thrustTorque = 0;
    this.heat = 0;
    this.radar = Infinity;
    this.rcsOn = false;
    this.rcsFiring = 0;
    this.xc = undefined;
    this.yc = undefined;
    this.recompute();
  }

  recompute() {
    const by = (this.byUid = new Map(this.parts.map((p) => [p.uid, p])));
    for (const p of this.parts) p.links = p.links.filter((u) => by.has(u));
    this.rootUid = rootUidOf(this.parts);
    const groups = (this.groups = computeGroups(this.parts));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of this.parts) {
      const hw = maxWidth(p.def) / 2;
      minX = Math.min(minX, p.x - hw); maxX = Math.max(maxX, p.x + hw);
      minY = Math.min(minY, p.bot); maxY = Math.max(maxY, p.top);
    }
    this.bounds = { minX, maxX, minY, maxY };
    this.length = maxY - minY;
    this.width = maxX - minX;
    this.engines = this.parts.filter((p) => isEngine(p.def));
    this.tanks = this.parts.filter((p) => p.def.fuel);
    this.rcsParts = this.parts.filter((p) => p.def.rcs);
    this.fins = this.parts.filter((p) => p.def.fins);
    this.legs = this.parts.filter((p) => p.def.legs);
    this.hasLegs = this.legs.length > 0;
    this.hasChute = this.parts.some((p) => p.def.chute);
    this.chuteAlt = Math.max(0, ...this.parts.filter((p) => p.def.chute).map((p) => cfgVal(p, 'deployAlt')));
    this.hasPod = this.parts.some((p) => p.def.pod);
    this.hasProbe = this.parts.some((p) => p.def.probe);
    this.solarParts = this.parts.filter((p) => p.def.solar);
    this.ecMax = this.parts.reduce((a, p) => a + (p.def.ec || 0), 0);
    this.torque = this.parts.reduce((a, p) => a + (p.def.torque || 0), 0);
    const gBot = new Map();
    for (const p of this.parts) { const g = groups.get(p.uid); gBot.set(g, Math.min(gBot.has(g) ? gBot.get(g) : Infinity, p.bot)); }
    const pts = [];
    for (const p of this.parts) {
      const wt = p.def.w / 2, wb = (p.def.wb !== undefined ? p.def.wb : p.def.w) / 2;
      pts.push([p.x - wt, p.top], [p.x + wt, p.top], [p.x - wb, p.bot], [p.x + wb, p.bot]);
    }
    for (const l of this.legs) {
      l.footX = l.x + (l.flip ? -1 : 1) * 1.3;
      l.footY = Math.min(l.bot - 0.8, gBot.get(groups.get(l.uid)) - 0.3);
      pts.push([l.footX, l.footY]);
    }
    this.contacts = convexHull(pts);
    this.computeTiers();
    this.updateMass();
  }

  /* Parts that leave if decoupler `decUid` fires (only parts in `present` count). */
  detachedFrom(decUid, present) {
    const root = this.rootUid;
    if (decUid === root || !present.has(root)) return [];
    const seen = new Set([root]), q = [root];
    while (q.length) {
      const u = q.pop();
      for (const l of this.byUid.get(u).links) if (present.has(l) && l !== decUid && !seen.has(l)) { seen.add(l); q.push(l); }
    }
    return [...present].filter((u) => !seen.has(u));
  }

  /* Tanks that will be dropped sooner drain first (this is what makes crossfeed boosters work). */
  computeTiers() {
    const prio = new Map();
    const present = new Set(this.parts.map((p) => p.uid));
    for (let s = this.stageIdx; s < this.stages.length; s++) for (const u of this.stages[s]) {
      const d = this.byUid.get(u);
      if (!d || !d.def.decoupler || !present.has(u)) continue;
      for (const q of this.detachedFrom(u, present)) { if (!prio.has(q)) prio.set(q, s); present.delete(q); }
    }
    const byG = new Map();
    for (const t of this.tanks) {
      const g = this.groups.get(t.uid);
      if (!byG.has(g)) byG.set(g, new Map());
      const pr = prio.has(t.uid) ? prio.get(t.uid) : 1e9;
      const m = byG.get(g);
      if (!m.has(pr)) m.set(pr, []);
      m.get(pr).push(t);
    }
    this.tiers = new Map();
    for (const [g, m] of byG) this.tiers.set(g, [...m.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]));
  }

  groupFuel(g) {
    let f = 0;
    for (const tier of this.tiers.get(g) || []) for (const t of tier) f += t.fuel;
    return f;
  }

  updateMass() {
    let M = 0, mx = 0, my = 0;
    for (const p of this.parts) {
      p.m = p.def.mass + p.fuel + p.solid + p.mono + p.ablator;
      M += p.m;
      mx += p.m * p.x;
      my += (p.m * (p.top + p.bot)) / 2;
    }
    const xc = mx / M, yc = my / M;
    let I = 0, rcsCap = 0;
    for (const p of this.parts) {
      const dx = p.x - xc, dy = (p.top + p.bot) / 2 - yc, w = maxWidth(p.def);
      I += p.m * (dx * dx + dy * dy + (p.def.h * p.def.h + w * w) / 12);
      if (p.def.rcs) rcsCap += p.def.rcsThrust * Math.max(1, Math.abs(dy));
    }
    this.M = M;
    this.I = Math.max(I, 0.3);
    this.rcsTorqueCap = rcsCap;
    if (this.xc !== undefined && (xc !== this.xc || yc !== this.yc)) {
      // keep the parts fixed in the world while the centre of mass moves
      const d = this.rotLocal(xc - this.xc, yc - this.yc);
      this.pos[0] += d[0]; this.pos[1] += d[1];
      if (this.landed) { this.landed.rx += d[0]; this.landed.ry += d[1]; }
    }
    this.xc = xc;
    this.yc = yc;
  }

  /* local vector -> world vector */
  rotLocal(lx, ly) {
    const ax = Math.cos(this.angle), ay = Math.sin(this.angle);
    return [ax * ly + ay * lx, ay * ly - ax * lx];
  }
  /* local point (x lateral, y along the axis) -> world point */
  toWorld(lx, ly) {
    const d = this.rotLocal(lx - this.xc, ly - this.yc);
    return [this.pos[0] + d[0], this.pos[1] + d[1]];
  }

  engineHasFuel(e) {
    if (e.def.solid) return e.solid > 0;
    return this.groupFuel(this.groups.get(e.uid)) > 1e-9;
  }

  isThrusting() {
    for (const e of this.engines) {
      if (!e.ignited) continue;
      if (e.def.solid) { if (e.solid > 0) return true; } else if (this.throttle > 0 && this.engineHasFuel(e)) return true;
    }
    return false;
  }

  /* Burn fuel for dt seconds at atmospheric pressure p (atm). Returns thrust in kN. */
  engineStep(dt, pressure) {
    let T = 0, gim = 0, tq = 0;
    const thr = this.throttle;
    const demand = new Map();
    for (const e of this.engines) {
      e.burn = 0;
      if (!e.ignited || e.def.solid || thr <= 0) continue;
      const g = this.groups.get(e.uid);
      demand.set(g, (demand.get(g) || 0) + (e.def.thrust / (e.def.ispVac * G0)) * thr * (cfgVal(e, 'thrustLimit') / 100) * dt);
    }
    const ratio = new Map();
    for (const [g, need] of demand) {
      let got = 0;
      for (const tier of this.tiers.get(g) || []) {
        let avail = 0;
        for (const t of tier) avail += t.fuel;
        if (avail <= 1e-12) continue;
        const take = Math.min(need - got, avail), f = take / avail;
        for (const t of tier) t.fuel = Math.max(0, t.fuel - t.fuel * f);
        got += take;
        if (got >= need - 1e-12) break;
      }
      ratio.set(g, need > 0 ? got / need : 0);
    }
    const pr = clamp(pressure, 0, 1);
    for (const e of this.engines) {
      const d = e.def;
      if (!e.ignited) continue;
      const isp = d.ispVac + (d.ispSL - d.ispVac) * pr;
      let frac;
      if (d.solid) {
        if (e.solid <= 0) continue;
        const flow = (d.thrust / (d.ispVac * G0)) * (cfgVal(e, 'srbLimit') / 100);
        const use = Math.min(e.solid, flow * dt);
        e.solid -= use;
        frac = use / ((d.thrust / (d.ispVac * G0)) * dt);
      } else frac = thr * (cfgVal(e, 'thrustLimit') / 100) * (ratio.get(this.groups.get(e.uid)) || 0);
      if (frac <= 0) continue;
      const f = ((d.thrust * isp) / d.ispVac) * frac * (e.inv ? -1 : 1); // upside-down engines push backwards
      e.burn = frac;
      T += f;
      tq += f * (e.x - this.xc);
      const fa = Math.abs(f);
      gim += fa * Math.sin((d.gimbal * Math.PI) / 180) * Math.abs((e.inv ? e.top : e.bot) - this.yc);
    }
    this.thrust = T;
    this.thrustTorque = tq;
    this.gimbalCap = gim;
    return T;
  }

  monoTotal() { let m = 0; for (const p of this.parts) m += p.mono; return m; }

  /* RCS: tx/ty translate (local, -1..1), rot = rotation command. Returns local force (kN) and
     the fraction of RCS rotation authority available. Monoprop flows from anywhere on the craft. */
  rcsStep(dt, tx, ty, rot) {
    this.rcsFiring = 0;
    if (!this.rcsOn || !this.rcsParts.length) return { fx: 0, fy: 0, k: 0 };
    const n = this.rcsParts.length, f = this.rcsParts[0].def.rcsThrust, isp = this.rcsParts[0].def.isp;
    const want = Math.min(1, Math.abs(tx)) + Math.min(1, Math.abs(ty)) + Math.min(1, Math.abs(rot));
    if (want <= 0) return { fx: 0, fy: 0, k: 1 };
    const flow = ((n * f) / (isp * G0)) * want * dt;
    const avail = this.monoTotal();
    if (avail <= 1e-9) return { fx: 0, fy: 0, k: 0 };
    const take = Math.min(flow, avail), k = take / flow;
    for (const p of this.parts) if (p.mono > 0) p.mono = Math.max(0, p.mono - (p.mono / avail) * take);
    this.rcsFiring = want * k;
    return { fx: tx * n * f * k, fy: ty * n * f * k, k };
  }

  /* Fire the next stage. onDetach(componentParts, decoupler) is called for each piece that separates,
     while the craft still holds its pre-separation pose. */
  activateNext(onDetach) {
    if (this.stageIdx >= this.stages.length) return null;
    const uids = this.stages[this.stageIdx++];
    const res = { separated: 0, ignited: [], chute: false };
    for (const u of uids) {
      const p = this.byUid.get(u);
      if (!p || !p.def.decoupler) continue;
      const present = new Set(this.parts.map((q) => q.uid));
      const det = new Set(this.detachedFrom(u, present));
      if (!det.size) continue;
      const comps = components(this.parts.filter((q) => det.has(q.uid)));
      if (onDetach) for (const comp of comps) onDetach(comp, p);
      this.parts = this.parts.filter((q) => !det.has(q.uid));
      this.recompute();
      res.separated += comps.length;
    }
    for (const u of uids) {
      const p = this.byUid.get(u);
      if (!p) continue;
      if (isEngine(p.def)) { p.ignited = true; res.ignited.push(p); }
      if (p.def.chute) { this.chuteOpen = true; res.chute = true; }
    }
    this.recompute();
    return res;
  }
}

function cloneParts(parts) { return parts.map((p) => ({ ...p, links: p.links.slice() })); }

/* Burn the current stage in vacuum at full throttle until its fuel is used up (or the parts the next
   stage drops are spent). Mutates `c`. */
function burnSim(c) {
  c.throttle = 1;
  c.recompute();
  const m0 = c.M;
  let tSL = 0, tVac = 0;
  for (const e of c.engines) if (e.ignited && c.engineHasFuel(e)) {
    const lim = cfgVal(e, e.def.solid ? 'srbLimit' : 'thrustLimit') / 100;
    tSL += ((e.def.thrust * e.def.ispSL) / e.def.ispVac) * lim; tVac += e.def.thrust * lim;
  }
  let watchE = [], watchT = [];
  const next = c.stages[c.stageIdx];
  if (next) {
    const present = new Set(c.parts.map((p) => p.uid));
    const det = new Set();
    for (const u of next) { const p = c.byUid.get(u); if (p && p.def.decoupler) for (const q of c.detachedFrom(u, present)) det.add(q); }
    for (const u of det) { const p = c.byUid.get(u); if (isEngine(p.def) && p.ignited) watchE.push(p); else if (p.def.fuel) watchT.push(p); }
  }
  let dv = 0, t = 0;
  for (let i = 0; i < 6000; i++) {
    const T = c.engineStep(0.5, 0);
    if (T <= 0) break;
    c.updateMass();
    dv += (T / c.M) * 0.5;
    t += 0.5;
    if (watchE.length) { if (watchE.every((e) => e.burn <= 0 || (e.def.solid ? e.solid <= 0 : !c.engineHasFuel(e)))) break; }
    else if (watchT.length && watchT.every((k) => k.fuel <= 1e-6)) break;
  }
  return { m0, dv, burn: t, twr: tSL / (m0 * 9.81), twrVac: tVac / (m0 * 9.81) };
}

/* Delta-v of every remaining stage. With `current`, the first row is what the already-lit engines can still do. */
function simulateStages(src, current) {
  const c = new Craft(cloneParts(src.parts), { stages: src.stages });
  c.stageIdx = src.stageIdx;
  c.recompute();
  const rows = [];
  if (current) rows.push({ uids: [], ...burnSim(c) });
  while (c.stageIdx < c.stages.length) {
    const uids = c.stages[c.stageIdx];
    c.activateNext(null);
    rows.push({ uids, ...burnSim(c) });
  }
  return rows;
}

function analyzeDesign(d) {
  const out = { valid: false, warnings: [], mass: 0, height: 0, width: 0, rows: [], total: 0, parts: [], stages: [], com: null, cot: null };
  if (!d.parts.length) { out.warnings.push({ lvl: 'info', text: 'Drag parts from the left to start building.' }); return out; }
  const parts = layoutDesign(d);
  out.parts = parts;
  const stageOf = resolveStages(d, parts);
  out.stages = stageListFrom(stageOf);
  const c = new Craft(cloneParts(parts), { stages: out.stages });
  out.mass = c.M;
  out.height = c.length;
  out.width = c.width;
  out.com = [c.xc, c.yc];
  out.rows = simulateStages(c, false);
  out.total = out.rows.reduce((a, r) => a + r.dv, 0);
  const hasPod = parts.some((p) => p.def.pod || p.def.probe);
  if (!hasPod) out.warnings.push({ lvl: 'err', text: 'Add a Lark Capsule or a probe core. Every craft needs something to control it.' });
  else if (!parts.some((p) => p.def.pod) && !parts.some((p) => p.def.ec && !p.def.probe) && !parts.some((p) => p.def.solar))
    out.warnings.push({ lvl: 'info', text: 'Tip: a probe core only holds a little charge. Add batteries or solar panels.' });
  const firstUids = new Set(out.stages[0] || []);
  const first = parts.filter((p) => isEngine(p.def) && firstUids.has(p.uid));
  if (!first.length) out.warnings.push({ lvl: 'warn', text: 'The first stage lights no engines.' });
  else {
    if (out.rows[0] && out.rows[0].twr < 1) out.warnings.push({ lvl: 'warn', text: `Liftoff thrust-to-weight is ${out.rows[0].twr.toFixed(2)}. Below 1.00 the rocket can't leave the pad.` });
    let T = 0, Tx = 0, Ty = 0;
    for (const e of first) { T += e.def.thrust; Tx += e.def.thrust * e.x; Ty += e.def.thrust * e.bot; }
    out.cot = [Tx / T, Ty / T];
    if (Math.abs(Tx / T - c.xc) > 0.15) out.warnings.push({ lvl: 'warn', text: 'Liftoff thrust is off-centre, so the rocket will spin. Use symmetry for side engines.' });
  }
  for (const e of c.engines) if (!e.def.solid && !c.engineHasFuel(e)) {
    out.warnings.push({ lvl: 'warn', text: `${e.def.name} has no fuel tank in its own stage.` });
    break;
  }
  const ci = parts.find((p) => p.def.chute), pod = parts.find((p) => p.def.pod);
  if (ci && pod && !ci.links.includes(pod.uid)) out.warnings.push({ lvl: 'info', text: 'Tip: the parachute belongs on top of the capsule.' });
  out.valid = hasPod;
  return out;
}

/* ---------------- example craft ---------------- */

const PRESETS = {
  'Sky Hopper': () => designFromStack(['chute', 'pod', 'decoupler', 'srb']),
  'Orbiter I': () => designFromStack(['chute', 'pod', 'tankM', 'wren', 'decoupler', 'tankL', 'tankL', 'fins', 'ox']),
  'Heavy Lifter': () => {
    const d = designFromStack(['chute', 'pod', 'tankM', 'wren', 'decoupler', 'tankXL', 'tankL', 'fins', 'ox']);
    const xl = d.parts.find((p) => p.id === 'tankXL').uid;
    const rd = attachPart(d, 'radDec', xl, 'side', 1, 0.6, true)[0];
    const booster = attachPart(d, 'srb', rd, 'side', 1, -0.2, false)[0];
    attachPart(d, 'nose2', booster, 'top', 0, 0, false);
    return d;
  },
  'Comms Probe': () => {
    const d = designFromStack(['probe', 'tankM125', 'gnat', 'decoupler', 'tankL', 'tankL', 'fins', 'ox']);
    const probe = d.parts.find((p) => p.id === 'probe').uid, tank = d.parts.find((p) => p.id === 'tankM125').uid;
    attachPart(d, 'solar', tank, 'side', 1, 0.2, true);
    attachPart(d, 'battery', tank, 'side', 1, 1.3, true);
    attachPart(d, 'antenna', probe, 'side', 1, 0, false);
    return d;
  },
  'Rescue Shuttle': () => {
    const d = designFromStack(['dockPort', 'pod', 'tankM', 'wren', 'decoupler', 'tankL', 'tankL', 'fins', 'ox']);
    const pod = d.parts.find((p) => p.id === 'pod').uid, tank = d.parts.find((p) => p.id === 'tankM').uid;
    attachPart(d, 'chuteRadial', pod, 'side', 1, 0.5, true);
    attachPart(d, 'rcs', tank, 'side', 1, 0.1, true);
    attachPart(d, 'monoPod', tank, 'side', 1, 0.7, true);
    return d;
  },
  'Cluster Lifter': () => {
    const d = designFromStack(['chute', 'pod', 'tankM', 'wren', 'decoupler', 'tankXL', 'twinMountL']);
    const mount = d.parts.find((p) => p.id === 'twinMountL').uid;
    attachPart(d, 'ox', mount, 'slot:0', 0, 0, true); // its twin fills the other slot
    attachPart(d, 'fins', d.parts.find((p) => p.id === 'tankXL').uid, 'side', 1, 7.2 - 2.2 * 0.75, true);
    return d;
  },
  'Pallid Lander': () => {
    const d = designFromStack(['chute', 'pod', 'tankL', 'legs', 'wren', 'decoupler', 'tankXL', 'tankL', 'kestrel', 'decoupler', 'tankXL', 'tankXL', 'fins', 'bison']);
    const pod = d.parts.find((p) => p.id === 'pod').uid;
    attachPart(d, 'rcs', pod, 'side', 1, 0.7, true);
    return d;
  },
};
