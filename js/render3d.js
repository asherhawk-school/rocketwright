'use strict';
/* Rocketwright — 3D graphics with Three.js.
   The physics still happens in one plane (z = 0). This file only draws it in 3D: round parts with lighting,
   planets as spheres, ground that stretches away from the flight plane, and a camera you can swing around.
   If Three.js or WebGL isn't available, the game falls back to the 2D drawing in render.js.

   Coordinates: world x/y are the flight plane, z points out of the screen. Everything is drawn relative to a
   floating origin (the camera's focus) so the GPU's 32-bit floats stay precise far from home. */

const R3 = {
  ok: false, on: true, fov: 50,
  flight: null, hangar: null, icons: null,
  yaw: 0, pitch: 0.12, hYaw: 0, hPitch: 0,
  crafts: new Map(), bodies: new Map(), mats: {},
};

function gfx3d() { return R3.ok && R3.on; }
/* Small seeded random numbers for scenery. */
function rng3(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function setGfx(mode) {
  R3.on = mode !== '2d';
  Store.set('gfx', R3.on ? '3d' : '2d');
  const fl = document.getElementById('game3d'), hb = document.getElementById('build3d');
  if (fl) fl.classList.toggle('hidden', !gfx3d());
  if (hb) hb.classList.toggle('hidden', !gfx3d());
}

function init3d() {
  R3.on = Store.get('gfx', '3d') !== '2d';
  if (typeof THREE === 'undefined') { R3.ok = false; setGfx(R3.on ? '3d' : '2d'); return; }
  try {
    const mk = (id) => {
      const r = new THREE.WebGLRenderer({ canvas: document.getElementById(id), antialias: true, alpha: true, logarithmicDepthBuffer: true });
      r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      r.outputEncoding = THREE.sRGBEncoding;
      return r;
    };
    R3.flight = { renderer: mk('game3d') };
    R3.hangar = { renderer: mk('build3d') };
    setupFlightScene();
    setupHangarScene();
    R3.ok = true;
  } catch (e) {
    console.warn('3D graphics unavailable, using 2D', e);
    R3.ok = false;
  }
  setGfx(R3.on ? '3d' : '2d');
}

/* ---------------- materials ---------------- */

const MAT_DEFS = {
  metal: ['#d6dade', 0.45, 0.45], white: ['#f1f2f4', 0.1, 0.55], dark: ['#3a3f47', 0.6, 0.45], black: ['#1b1e23', 0.4, 0.6],
  orange: ['#c8642c', 0.2, 0.6], red: ['#c23b2a', 0.1, 0.6], yellow: ['#e0b030', 0.3, 0.5], glass: ['#1d3a5c', 0.8, 0.15],
  bronze: ['#6b4a2e', 0.2, 0.8], ablator: ['#4a3424', 0.0, 0.95], gold: ['#d4a640', 0.9, 0.3], solar: ['#1d3a7a', 0.6, 0.25],
  mono: ['#a8cbb0', 0.3, 0.5], argon: ['#8fa8c8', 0.5, 0.4], chute: ['#f06a3c', 0.0, 0.8], drogue: ['#f4c64a', 0.0, 0.8],
  rubber: ['#202328', 0.0, 0.9], grey: ['#8a9099', 0.5, 0.5], cream: ['#d8d0b8', 0.1, 0.7], fabric: ['#c8b48a', 0.0, 0.9],
  green: ['#5a6a5a', 0.4, 0.5], blue: ['#4a7fd0', 0.4, 0.4], lamp: ['#7dffa8', 0.0, 0.5, '#2a8a4a'],
};
function mat(key, opts) {
  const d = MAT_DEFS[key] || MAT_DEFS.metal;
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(d[0]), metalness: d[1], roughness: d[2] });
  if (d[3]) m.emissive = new THREE.Color(d[3]);
  if (opts) Object.assign(m, opts);
  return m;
}

/* ---------------- part geometry ----------------
   Each part becomes a group in craft-local metres (x lateral, y along the craft, z out of the flight plane),
   positioned like the 2D drawing: at x = p.x, with the part's own top and bottom heights. */

const SEG = 28;
const V2 = (r, y) => new THREE.Vector2(Math.max(r, 0.001), y);
function lathe(pts, m, segs = SEG) { return new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y)), segs), m); }
function cyl(rt, rb, h, y, m, segs = SEG, open = false) {
  const me = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segs, 1, open), m);
  me.position.y = y;
  return me;
}
function box(w, h, d, x, y, z, m) {
  const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  me.position.set(x, y, z);
  return me;
}
function sphere(r, x, y, z, m, sx = 1, sy = 1, sz = 1) {
  const me = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), m);
  me.position.set(x, y, z); me.scale.set(sx, sy, sz);
  return me;
}
function band(r, y, h, m) { return cyl(r * 1.01, r * 1.01, h, y, m); }
/* A flat shape (in x/y) extruded thin along z. */
function slab(pts, depth, m) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return new THREE.Mesh(g, m);
}
/* Curved bell or ogive: n points along a quadratic curve from (r0, y0) through control (rc, yc) to (r1, y1). */
function curve(r0, y0, rc, yc, r1, y1, n = 10) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    out.push([a * r0 + b * rc + c * r1, a * y0 + b * yc + c * y1]);
  }
  return out;
}

function buildPart(p, owner) {
  const d = p.def, h = d.h, top = p.top, bot = p.bot, cy = (top + bot) / 2;
  const hw = d.w / 2, hb = (d.wb !== undefined ? d.wb : d.w) / 2;
  const g = new THREE.Group();
  const add = (...ms) => { for (const m of ms) g.add(m); };
  const M = (k, o) => mat(k, o);
  switch (d.kind) {
    case 'pod': case 'pod3': {
      const r1 = hw * (d.kind === 'pod' ? 0.93 : 1);
      add(lathe([[0, bot + 0.12], [hb, bot + 0.12], [r1, top], [0, top]], M('metal')));
      add(cyl(hb + 0.02, hb + 0.02, 0.15, bot + 0.07, M('bronze')));
      add(band(r1, top - 0.05, 0.1, M('red')));
      const wins = d.kind === 'pod' ? [0] : [-0.7, 0, 0.7];
      for (const a of wins) {
        const y = bot + (d.kind === 'pod' ? 0.8 : 1.1), r = lerp(hb, r1, (y - bot) / h);
        const w = box(0.5, 0.36, 0.06, r * Math.sin(a), y, r * Math.cos(a), M('glass'));
        w.rotation.y = a; w.rotation.x = -Math.atan2(hb - r1, h) * 0.9;
        add(w);
      }
      break;
    }
    case 'cockpit': {
      add(lathe([[0, bot], [hb, bot], ...curve(hb, bot, hb, bot + h * 0.7, hw, top).slice(1), [0, top]], M('white')));
      add(band(hb, bot + 0.05, 0.1, M('red')));
      add(sphere(0.42, -hb * 0.62, bot + h * 0.45, 0, M('glass'), 0.7, 1.6, 1));
      break;
    }
    case 'chute': case 'drogue': {
      add(lathe([[0, bot], [hw * 0.93, bot], [hw * 0.62, top], [0, top]], M(d.kind === 'drogue' ? 'drogue' : 'chute')));
      add(band(hw * 0.8, bot + h * 0.4, 0.05, M('dark')));
      break;
    }
    case 'chuteSide': {
      add(lathe([[0, bot], ...curve(hw * 0.2, bot, hw, bot, hw, bot + hw).slice(0), [hw, top - hw], ...curve(hw, top - hw, hw, top, 0, top)], M('chute')));
      break;
    }
    case 'wheel': {
      add(cyl(hw, hw, h, cy, M('dark')), band(hw, cy, h * 0.2, M('yellow')));
      break;
    }
    case 'tank': case 'fuselage': case 'gasdrum': {
      const col = d.kind === 'gasdrum' ? 'argon' : d.kind === 'fuselage' ? 'white' : 'metal';
      add(cyl(hw, hw, h, cy, M(col)));
      add(band(hw, top - 0.05, 0.1, M('dark')), band(hw, bot + 0.05, 0.1, M('dark')));
      if (d.kind === 'tank' && h > 1.5) {
        const n = Math.round(h / 1.8);
        for (let i = 1; i <= n; i++) add(band(hw, bot + (h * i) / (n + 1), 0.12, M(hw > 1.2 ? 'orange' : 'black')));
      }
      break;
    }
    case 'radtank': case 'gastank': {
      add(lathe([...curve(0, bot, hw, bot, hw, bot + hw), ...curve(hw, top - hw, hw, top, 0, top)], M(d.kind === 'gastank' ? 'argon' : 'metal')));
      add(band(hw, cy, 0.08, M('black')));
      break;
    }
    case 'monotank': add(sphere(1, 0, cy, 0, M('mono'), hw, h / 2, hw)); break;
    case 'decoupler': add(cyl(hw + 0.04, hw + 0.04, h, cy, M('black')), band(hw + 0.04, cy, h * 0.25, M('yellow'))); break;
    case 'raddec': add(box(2 * hw, h, 2 * hw * 0.8, 0, cy, 0, M('black')), box(hw * 0.6, h - 0.2, 2 * hw * 0.82, 0, cy, 0, M(d.crossfeed ? 'blue' : 'yellow'))); break;
    case 'mount': {
      add(lathe([[0, bot], [hb, bot], [hw, top], [0, top]], M('grey')));
      add(band(hw, top - 0.04, 0.08, M('yellow')));
      for (const sx of d.slots) { const m = cyl(0.38, 0.38, 0.12, bot - 0.02, M('black')); m.position.x = sx; add(m); }
      break;
    }
    case 'adapter': case 'tailcone': case 'intake': {
      if (d.kind === 'tailcone') add(lathe([[0, top], [hw, top], ...curve(hw, top, hw, bot + h * 0.3, hb, bot).slice(1), [0, bot]], M('white')));
      else add(lathe([[0, bot], [hb, bot], [hw, top], [0, top]], M(d.kind === 'intake' ? 'grey' : 'metal')));
      if (d.kind === 'adapter') add(band(hb, bot + 0.04, 0.08, M('dark')), band(hw, top - 0.04, 0.08, M('dark')));
      if (d.kind === 'intake') { add(cyl(hw * 0.85, hw * 0.85, 0.05, top + 0.01, M('black'))); add(band(hb, bot + 0.05, 0.1, M('red'))); }
      break;
    }
    case 'nose': {
      add(lathe([[0, bot], [hb, bot], ...curve(hb, bot, hb, bot + h * 0.75, hw, top).slice(1), [0, top]], M('white')));
      add(band(hb, bot + 0.06, 0.12, M('red')));
      break;
    }
    case 'pylon': add(box(2 * hw, h, 2 * hw, 0, cy, 0, M('dark'))); break;
    case 'fins': {
      const f = slab([[-hw, top], [hw, bot + h * 0.32], [hw, bot], [-hw, bot]], 0.1, M('red'));
      add(f);
      break;
    }
    case 'legs': {
      const fx = p.footX !== undefined ? Math.abs(p.footX - p.x) : 1.3, fy = p.footY !== undefined ? p.footY : bot - 0.9;
      add(box(2 * hw * 0.55, h, 0.4, -hw + hw * 0.55, cy, 0, M('grey')));
      const strut = (x0, y0, x1, y1, r) => {
        const L = Math.hypot(x1 - x0, y1 - y0), m = cyl(r, r, L, 0, M('grey'), 8);
        m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
        m.rotation.z = Math.atan2(x0 - x1, y1 - y0);
        return m;
      };
      add(strut(-hw + 0.15, top - 0.15, fx, fy + 0.1, 0.07), strut(-hw + 0.15, bot + 0.1, lerp(-hw, fx, 0.6), lerp(bot, fy, 0.55), 0.05));
      add(cyl(0.38, 0.42, 0.1, fy + 0.05, M('dark'), 16));
      g.userData.foot = true;
      g.children[g.children.length - 1].position.x = fx;
      break;
    }
    case 'rcs': {
      add(box(2 * hw, h, 2 * hw, 0, cy, 0, M('cream')));
      for (const [x, y, rz] of [[hw + 0.06, cy, -Math.PI / 2], [0, top + 0.06, 0], [0, bot - 0.06, Math.PI]]) {
        const n = cyl(0.04, 0.1, 0.14, 0, M('black'), 8); n.position.set(x, y, 0); n.rotation.z = rz; add(n);
      }
      break;
    }
    case 'sensor': add(box(2 * hw, h, 2 * hw, 0, cy, 0, M('white')), sphere(hw * 0.4, 0, cy, hw, M(d.dial ? 'lamp' : 'orange'))); break;
    case 'jar': add(cyl(hw, hw, h - 0.2, cy, M('metal')), band(hw, top - 0.06, 0.12, M('dark')), band(hw, bot + 0.06, 0.12, M('dark'))); break;
    case 'spike': add(box(2 * hw, h * 0.35, 2 * hw, 0, top - h * 0.175, 0, M('grey')), cyl(0.001, hw * 0.45, h * 0.65, bot + h * 0.325, M('gold'), 8)); break;
    case 'sniffer': add(box(2 * hw, h, 2 * hw, 0, cy, 0, M('cream')), box(0.2, 0.2, 0.2, hw + 0.1, top - 0.18, 0, M('black'))); break;
    case 'antenna': add(box(2 * hw, 0.3, 2 * hw, 0, bot + 0.15, 0, M('grey')), cyl(0.025, 0.025, h - 0.3, bot + 0.3 + (h - 0.3) / 2, M('metal'), 6), sphere(0.08, 0, top, 0, M('red'))); break;
    case 'dock': add(cyl(hw, hw, h * 0.6, bot + h * 0.3, M('dark')), lathe([[0, bot + h * 0.6], [hw * 0.8, bot + h * 0.6], [hw * 0.55, top], [0, top]], M('metal')), band(hw * 0.5, top - 0.03, 0.06, M('yellow'))); break;
    case 'probe': add(lathe([[0, bot], [hw, bot], [hw * 0.8, top], [0, top]], M('grey')), band(hw * 0.92, bot + h * 0.47, h * 0.25, M('gold'))); break;
    case 'asteroid': {
      // a lumpy rock: an icosphere pushed in and out by a smooth function of direction (so shared corners match)
      const geo = new THREE.IcosahedronGeometry(hw, 2), pos = geo.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).normalize();
        const k = 0.78 + 0.12 * Math.sin(v.x * 3.1 + d.h) * Math.cos(v.y * 2.7) + 0.1 * Math.sin(v.z * 4.3 + v.x * 1.7);
        pos.setXYZ(i, v.x * hw * k, v.y * hw * k, v.z * hw * k);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, M('grey', { color: new THREE.Color('#7a746a'), roughness: 0.95, metalness: 0.05, flatShading: true }));
      m.position.y = cy; add(m);
      break;
    }
    case 'clamp': add(box(2 * hw, h, 2 * hw, 0, cy, 0, M('red')), box(0.2, 0.35, 2 * hw * 0.8, -hw - 0.05, top - 0.28, 0, M('dark'))); break;
    case 'light': {
      add(box(2 * hw, h, 2 * hw, 0, cy, 0, M('dark')), box(0.06, h * 0.75, 2 * hw * 0.75, hw, cy, 0, M(p.lit ? 'lamp' : 'grey', p.lit ? { emissive: new THREE.Color('#fff0c0'), color: new THREE.Color('#fff6dd') } : undefined)));
      if (p.lit) { const L = new THREE.PointLight(0xfff0c8, 1.6, 45, 1.5); L.position.set(hw + 2, cy, 0); add(L); }
      break;
    }
    case 'claw': {
      add(cyl(hw * 0.7, hw * 0.7, h * 0.45, top - h * 0.225, M('grey')), band(hw * 0.7, top - h * 0.3, 0.08, M('yellow')));
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + Math.PI / 4, spread = p.grabbed != null ? 0.75 : 0.97;
        const f = box(0.1, h * 0.6, 0.1, Math.cos(a) * hw * (0.6 + spread) / 2, bot + h * 0.28, Math.sin(a) * hw * (0.6 + spread) / 2, M('dark'));
        f.rotation.z = -Math.cos(a) * 0.35; f.rotation.x = Math.sin(a) * 0.35; add(f);
      }
      break;
    }
    case 'dish': {
      add(cyl(0.04, 0.04, hw * 0.9, cy, M('metal'), 6));
      const dsh = new THREE.Mesh(new THREE.SphereGeometry(hw, 20, 10, 0, TAU, 0, 0.9), M(d.relayCol ? 'yellow' : 'white', { side: THREE.DoubleSide }));
      dsh.rotation.z = -Math.PI / 2; dsh.position.set(-hw * 0.2, cy, 0); add(dsh);
      add(cyl(0.015, 0.015, hw * 0.9, cy, M('dark'), 4)); // feed arm
      break;
    }
    case 'relayant': add(box(2 * hw, 0.2, 2 * hw, 0, bot + 0.1, 0, M('dark')), cyl(0.03, 0.03, h - 0.2, bot + 0.2 + (h - 0.2) / 2, M('metal'), 6),
      band(hw * 0.85, bot + h * 0.45, 0.04, M('yellow')), band(hw * 0.65, bot + h * 0.65, 0.04, M('yellow')), band(hw * 0.45, bot + h * 0.85, 0.04, M('yellow')),
      sphere(0.06, 0, top, 0, M('lamp'))); break;
    case 'scanner': add(box(2 * hw, h * 0.7, 2 * hw, 0, bot + h * 0.35, 0, M('dark')), sphere(hw * 0.4, 0, bot + h * 0.35, hw, M('lamp')),
      cyl(0.02, 0.02, h * 0.3, top - h * 0.15, M('metal'), 6), sphere(0.05, 0, top, 0, M('orange'))); break;
    case 'drill': add(cyl(hw, hw, h * 0.4, top - h * 0.2, M('yellow')), cyl(hw * 0.45, 0.03, h * 0.6, bot + h * 0.3, M('grey'), 10)); break;
    case 'oretank': add(cyl(hw, hw, h, cy, M('bronze')), band(hw, bot + 0.13, 0.1, M('black')), band(hw, top - 0.13, 0.1, M('black')),
      box(hw * 0.6, h * 0.2, 0.05, 0, cy, hw, M('yellow'))); break;
    case 'converter': add(box(2 * hw, h, 2 * hw * 0.8, 0, cy, 0, M('grey')), box(2 * hw * 1.01, 0.14, 2 * hw * 0.81, 0, bot + h * 0.49, 0, M('yellow')),
      cyl(0.08, 0.08, h * 0.35, bot + h * 0.8, M('metal'), 8)); break;
    case 'eva': {
      add(box(0.55, 0.44, 0.28, 0, bot + 0.68, -0.22, M('grey'))); // backpack
      add(box(0.16, 0.5, 0.2, -0.11, bot + 0.25, 0, M('white')), box(0.16, 0.5, 0.2, 0.11, bot + 0.25, 0, M('white')));
      add(box(0.18, 0.08, 0.24, -0.11, bot + 0.04, 0.01, M('dark')), box(0.18, 0.08, 0.24, 0.11, bot + 0.04, 0.01, M('dark')));
      add(sphere(0.25, 0, bot + 0.68, 0, M('white'), 0.95, 1.05, 0.75)); // body
      add(band(0.24, bot + 0.66, 0.06, M('orange')));
      add(box(0.1, 0.38, 0.12, -0.31, bot + 0.66, 0, M('white')), box(0.1, 0.38, 0.12, 0.31, bot + 0.66, 0, M('white')));
      add(sphere(0.22, 0, bot + 1.07, 0, M('white')), sphere(0.16, 0, bot + 1.06, 0.1, M('glass'), 1, 0.75, 0.7)); // helmet and visor
      break;
    }
    case 'flag': {
      add(cyl(0.035, 0.035, h, cy, M('metal'), 8), cyl(0.12, 0.12, 0.06, bot + 0.03, M('bronze'), 10));
      add(box(1.0, 0.6, 0.02, 0.535, top - 0.36, 0, M('blue')), box(0.3, 0.3, 0.03, 0.535, top - 0.36, 0, M('white')));
      break;
    }
    case 'battery': add(box(2 * hw, h, 2 * hw, 0, cy, 0, M('dark')), box(hw, 0.08, 0.1, 0, top - 0.06, hw, M('yellow'))); break;
    case 'batring': add(cyl(hw, hw, h, cy, M('dark')), band(hw, cy, h * 0.4, M('yellow'))); break;
    case 'batbank': {
      add(cyl(hw, hw, h, cy, M('dark')));
      for (let y = bot + 0.15; y < top - 0.1; y += 0.25) add(band(hw, y, 0.07, M('yellow')));
      break;
    }
    case 'fuelcell': case 'fuelcellL': {
      if (d.kind === 'fuelcell') add(box(2 * hw, h, 2 * hw, 0, cy, 0, M('green')));
      else add(cyl(hw, hw, h, cy, M('green')));
      add(box(hw * 0.6, 0.06, 0.1, 0, top - 0.06, d.kind === 'fuelcell' ? hw : hw * 0.98, M('lamp')));
      break;
    }
    case 'solar': {
      add(box(hw * 1.2, h * 0.2, 0.15, -hw * 0.4, cy, 0, M('grey')));
      const panel = box(0.04, h, 1.3, hw * 0.4, cy, 0, M('solar'));
      add(panel, box(0.05, h * 1.01, 0.04, hw * 0.4, cy, 0, M('metal')));
      break;
    }
    case 'shield': {
      const frac = d.ablator ? p.ablator / d.ablator : 0;
      const m = M('ablator'); m.color.set(mixColor('#2a1e16', '#8a5a2e', frac));
      add(lathe([[0, bot - 0.1], ...curve(0, bot - 0.1, hw * 0.9, bot - 0.05, hw + 0.05, top), [0, top]], m));
      break;
    }
    case 'bloom': {
      if (p.inflated) {
        const W = d.wOpen / 2;
        add(lathe([[0, bot - 0.7], ...curve(0, bot - 0.7, W * 0.85, bot - 0.5, W, top), [hw, top + 0.05], [0, top + 0.05]], M('fabric')));
        for (let i = 1; i <= 3; i++) { const t = band(W * (0.25 + i * 0.22), top - 0.15 * i, 0.07, M('bronze')); t.scale.y = 1; add(t); }
      } else add(cyl(hw, hw, h, cy, M('fabric')), band(hw, cy, 0.08, M('dark')));
      break;
    }
    case 'engine': {
      const mh = h * 0.3, bw = d.bell / 2, yb = top - mh, tw = Math.min(0.38, hw * 0.4);
      add(lathe([[0, top], [hw, top], [hw * 0.55, yb], [0, yb]], M('dark')));
      const bell = lathe(curve(tw, yb, tw * 1.1, lerp(yb, bot, 0.65), bw, bot), M('grey', { side: THREE.DoubleSide }));
      add(bell, band(bw, bot + 0.03, 0.06, M('dark')));
      if (d.nuclear) add(cyl(hw, hw, 0.6, yb + 0.25, M('metal')), band(hw, yb + 0.25, 0.15, M('yellow')));
      break;
    }
    case 'srb': {
      const nz = Math.min(0.55, h * 0.18), bw = hw * 0.92;
      add(cyl(bw, bw, h - nz, bot + nz + (h - nz) / 2, M('white')));
      for (const f of [0.18, 0.55]) add(band(bw, bot + nz + (h - nz) * f + 0.15, 0.3, M('red')));
      add(band(bw, top - 0.06, 0.12, M('dark')));
      add(lathe([[bw * 0.38, bot + nz], [bw * 0.67, bot]], M('dark', { side: THREE.DoubleSide })));
      break;
    }
    case 'aerospike': {
      add(cyl(hw, hw, h * 0.3, top - h * 0.15, M('dark')), band(hw, top - h * 0.3, 0.08, M('orange')));
      add(lathe([[hw * 0.95, top - h * 0.3], ...curve(hw * 0.95, top - h * 0.3, hw * 0.3, bot + h * 0.3, hw * 0.12, bot), [0, bot]], M('grey')));
      break;
    }
    case 'ion': {
      add(lathe([[0, top], [hw, top], [hw * 0.85, bot + 0.12], [0, bot + 0.12]], M('metal')));
      add(cyl(hw * 0.8, hw * 0.8, 0.14, bot + 0.07, M('black')));
      add(cyl(hw * 0.7, hw * 0.7, 0.02, bot - 0.005, M('blue', { emissive: new THREE.Color('#1a3a80') })));
      break;
    }
    case 'jet': {
      add(lathe([[0, top], [hw, top], [hw * 0.95, bot + h * 0.3], [hw * 0.6, bot], [0, bot]], M('grey')));
      add(band(hw, top - 0.05, 0.1, M('yellow')), cyl(hw * 0.85, hw * 0.85, 0.04, top + 0.005, M('black')));
      break;
    }
    case 'cabin': {
      add(cyl(hw, hw, h, cy, M('white')), band(hw, top - 0.05, 0.1, M('dark')), band(hw, bot + 0.05, 0.1, M('dark')));
      for (const a of [-0.5, 0.5, Math.PI - 0.5, Math.PI + 0.5]) add(sphere(0.22, hw * Math.sin(a) * 0.97, cy + 0.1, hw * Math.cos(a) * 0.97, M('glass'), 1, 1, 0.3));
      break;
    }
    case 'fairing': add(cyl(hw, hw, h, cy, M('dark')), band(hw, top - 0.04, 0.08, M('yellow'))); break;
    case 'fairHalf': {
      // one half of a shell; x = 0 is its middle, the open side faces -x
      const r = hw;
      const prof = [[r, bot], [r, bot + h * 0.7], ...curve(r, bot + h * 0.7, r, top - h * 0.05, 0.01, top).slice(1)];
      const m = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([a, b]) => V2(a, b)), 14, 0, Math.PI), M('white', { side: THREE.DoubleSide }));
      m.rotation.y = -Math.PI / 2;
      m.position.x = -r / 2;
      add(m);
      break;
    }
    case 'strut': {
      const L = Math.hypot(2 * hw + 0.5, h - 0.2), m = cyl(0.06, 0.06, L, 0, M('grey'), 8);
      m.position.set(0.25, cy, 0); m.rotation.z = Math.atan2(2 * hw + 0.5, h - 0.2);
      add(m, box(0.25, 0.25, 0.25, -hw + 0.12, top - 0.12, 0, M('dark')), box(0.25, 0.25, 0.25, hw + 0.47, bot + 0.12, 0, M('dark')));
      break;
    }
    case 'airbrake': {
      add(box(2 * hw, h, 0.5, 0, cy, 0, M('grey')));
      const flap = box(0.06, h * 0.9, 0.8, hw + 0.04, cy, 0, M('metal'));
      if (p.brake) { flap.geometry.translate(0, h * 0.45, 0); flap.position.y = bot + 0.05; flap.rotation.z = -1.0; }
      add(flap);
      break;
    }
    case 'scoop': add(lathe([[0, bot], [hw * 0.6, bot], [hw, top - 0.1], [hw, top], [0, top]], M('grey')), cyl(hw * 0.7, hw * 0.7, 0.03, top + 0.01, M('black'))); break;
    case 'wing': case 'strake': case 'elevon': case 'canard': {
      // planform from the root (x = 0) out to the tip, swept back
      const sweep = d.kind === 'strake' ? 0.7 : d.kind === 'wing' ? 0.45 : 0.2, tipC = d.kind === 'strake' ? 0.15 : d.kind === 'wing' ? 0.35 : 0.7;
      const span = 2 * hw;
      add(slab([[0, top], [span, top - h * sweep], [span, top - h * sweep - h * tipC], [0, bot]], 0.14, M(d.ctrlSurf ? 'white' : 'metal')));
      if (d.ctrlSurf) add(slab([[0, bot + h * 0.35], [span, top - h * sweep - h * tipC * 0.55], [span, top - h * sweep - h * tipC], [0, bot]], 0.16, M('yellow')));
      else add(box(0.12, h * tipC, 0.16, span - 0.06, top - h * sweep - (h * tipC) / 2, 0, M('red')));
      g.userData.wing = true;
      break;
    }
    case 'gear': case 'rwheel': {
      const R = d.wheelR, out = p.gearUp ? hw - R * 0.2 : hw + d.leg;
      add(box(2 * hw, h, 0.5, 0, cy, 0, M('grey')));
      if (!p.gearUp) { const l = cyl(0.07, 0.07, d.leg + 0.1, 0, M('metal'), 8); l.rotation.z = Math.PI / 2; l.position.set(hw + d.leg / 2, cy, 0); add(l); }
      const track = d.motor ? 0.85 : 0.25, tyreW = d.motor ? 0.4 : 0.22;
      for (const z of [-track, track]) {
        const t = cyl(R, R, tyreW, 0, M('rubber'), 18); t.rotation.x = Math.PI / 2; t.position.set(out, cy, z); add(t);
        const hub = cyl(R * 0.45, R * 0.45, tyreW + 0.02, 0, M(d.motor ? 'yellow' : 'metal'), 12); hub.rotation.x = Math.PI / 2; hub.position.set(out, cy, z); add(hub);
      }
      const axle = cyl(0.05, 0.05, track * 2, 0, M('metal'), 6); axle.rotation.x = Math.PI / 2; axle.position.set(out, cy, 0); add(axle);
      break;
    }
    default: add(cyl(hw, hb, h, cy, M('metal')));
  }
  // where it goes on the craft
  const outer = new THREE.Group();
  if (d.wing) {
    // wings stick out of the flight plane, from the side of the part they're attached to
    const host = owner && owner.byUid ? owner.byUid.get(p.parent) : null;
    const s = p.flip ? -1 : 1;
    const hx = host ? host.x : p.x - s * hw, hr = host ? partHalfWidthAt(host, cy) : 0.6;
    outer.position.set(hx, 0, s * hr);
    outer.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    outer.add(g);
  } else {
    outer.position.x = p.x;
    if (p.flip) g.scale.x = -1;
    if (p.inv) { g.scale.y = -1; g.position.y = top + bot; }
    outer.add(g);
  }
  outer.userData.uid = p.uid;
  const mats = [];
  outer.traverse((o) => { if (o.isMesh) { o.userData.uid = p.uid; mats.push(o.material); } });
  return { obj: outer, mats };
}

/* A fairing's shell over its payload. */
function buildShell(f, alpha) {
  const H = shellH(f), hw = f.def.shellW / 2, y0 = f.top, y1 = f.top + H;
  const prof = [[f.def.w / 2, y0], [hw, y0 + Math.min(0.5, H * 0.1)], [hw, y0 + H * 0.65], ...curve(hw, y0 + H * 0.65, hw, y1, 0.01, y1).slice(1)];
  const m = mat('white', alpha < 1 ? { transparent: true, opacity: alpha, depthWrite: false, side: THREE.DoubleSide } : {});
  const me = lathe(prof, m, 36);
  me.position.x = f.x;
  if (f.inv) { me.scale.y = -1; me.position.y = 2 * f.top; }
  me.userData.uid = f.uid;
  return me;
}

/* State that changes how a part looks. */
function partSig(p, owner) {
  const host = p.def.wing && owner && owner.byUid ? owner.byUid.get(p.parent) : null;
  const extra = p.def.legs ? `${p.footX}|${p.footY}` : host ? `${host.x}|${host.id}|${host.top}` : '';
  return `${extra}|${p.id}|${p.x.toFixed(3)}|${p.top.toFixed(3)}|${p.flip ? 1 : 0}${p.inv ? 1 : 0}|${p.gearUp ? 1 : 0}${p.lit ? 1 : 0}${p.grabbed != null ? 1 : 0}${p.inflated ? 1 : 0}${p.shell ? 1 : 0}${p.brake ? 1 : 0}|${p.shell ? shellH(p) : ''}|${p.def.ablator ? Math.round(p.ablator / p.def.ablator * 10) : ''}`;
}

/* Keep a 3D model of a craft in step with its parts. */
function craftModel(store, c, shellAlpha = 1) {
  let m = store.get(c);
  if (!m) {
    m = { root: new THREE.Group(), inner: new THREE.Group(), parts: new Map(), shells: new Map(), fx: new THREE.Group() };
    m.root.add(m.inner);
    m.inner.add(m.fx);
    store.set(c, m);
  }
  const seen = new Set();
  for (const p of c.parts) {
    seen.add(p.uid);
    const sig = partSig(p, c);
    const cur = m.parts.get(p.uid);
    if (cur && cur.sig === sig) continue;
    if (cur) { m.inner.remove(cur.obj); disposeObj(cur.obj); }
    const built = buildPart(p, c);
    built.sig = sig;
    m.inner.add(built.obj);
    m.parts.set(p.uid, built);
  }
  for (const [u, cur] of m.parts) if (!seen.has(u)) { m.inner.remove(cur.obj); disposeObj(cur.obj); m.parts.delete(u); }
  // fairing shells
  const want = new Set();
  for (const f of c.shells || []) {
    const sig = `${f.x}|${f.top}|${shellH(f)}|${f.inv}`;
    want.add(f.uid);
    const cur = m.shells.get(f.uid);
    if (cur && cur.sig === sig) continue;
    if (cur) { m.inner.remove(cur.obj); disposeObj(cur.obj); }
    const obj = buildShell(f, shellAlpha);
    m.inner.add(obj);
    m.shells.set(f.uid, { obj, sig });
  }
  for (const [u, cur] of m.shells) if (!want.has(u)) { m.inner.remove(cur.obj); disposeObj(cur.obj); m.shells.delete(u); }
  return m;
}
function disposeObj(o) {
  o.traverse((x) => {
    if (x.geometry) x.geometry.dispose();
    if (x.material) (Array.isArray(x.material) ? x.material : [x.material]).forEach((mm) => { if (mm.map) mm.map.dispose(); mm.dispose(); });
  });
}
function dropModel(store, c, scene) {
  const m = store.get(c);
  if (!m) return;
  scene.remove(m.root);
  disposeObj(m.root);
  store.delete(c);
}

/* ---------------- flight scene ---------------- */

function setupFlightScene() {
  const S = R3.flight;
  S.scene = new THREE.Scene();
  S.camera = new THREE.PerspectiveCamera(R3.fov, 1, 0.1, 1e13);
  S.sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  S.sun.target.position.set(0, 0, 0);
  S.scene.add(S.sun, S.sun.target);
  S.amb = new THREE.AmbientLight(0x8090b0, 0.35);
  S.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x3a3020, 0.35);
  S.scene.add(S.amb, S.hemi);
  S.world = new THREE.Group();
  S.scene.add(S.world);
  S.crafts = new Map();
  // stars
  const n = 2200, pos = new Float32Array(n * 3), rnd = rng3(7);
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, a = rnd() * TAU, r = Math.sqrt(1 - u * u);
    pos[i * 3] = r * Math.cos(a) * 1e11; pos[i * 3 + 1] = r * Math.sin(a) * 1e11; pos[i * 3 + 2] = u * 1e11;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  S.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false }));
  S.scene.add(S.stars);
  // particles: smoke (normal blending) and fire (additive)
  S.smoke = makeParticles(false);
  S.fire = makeParticles(true);
  S.scene.add(S.smoke.points, S.fire.points);
  // plasma glow on reentry
  S.plasma = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,170,80'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  S.scene.add(S.plasma);
  S.ground = { mesh: null, water: null, key: '' };
  S.pad = buildPadModel();
  S.world.add(S.pad);
  S.clouds = new THREE.Group();
  S.world.add(S.clouds);
  S.raycaster = new THREE.Raycaster();
}

const PARTICLE_MAX = 900;
function makeParticles(additive) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(PARTICLE_MAX * 3), col = new Float32Array(PARTICLE_MAX * 4), size = new Float32Array(PARTICLE_MAX);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color4', new THREE.BufferAttribute(col, 4));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { scale: { value: 800 } },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec4 color4; attribute float size; uniform float scale; varying vec4 vC;
      void main() {
        vC = color4;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(size * scale / -mv.z, 1.0, 256.0);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec4 vC;
      void main() {
        #include <logdepthbuf_fragment>
        vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0;
        if (r > 1.0) discard;
        gl_FragColor = vec4(vC.rgb, vC.a * (1.0 - r));
      }`,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  return { points, g, pos, col, size };
}

let _glowTex = {};
function glowTexture(rgb) {
  if (_glowTex[rgb]) return _glowTex[rgb];
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const x = cv.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.4, `rgba(${rgb},0.45)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  return (_glowTex[rgb] = new THREE.CanvasTexture(cv));
}
let _cloudTex = null;
function cloudTexture() {
  if (_cloudTex) return _cloudTex;
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
  const x = cv.getContext('2d');
  for (const [cx, cy, r] of [[40, 36, 22], [64, 28, 26], [90, 36, 20], [64, 42, 22]]) {
    const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 64);
  }
  return (_cloudTex = new THREE.CanvasTexture(cv));
}

/* The launch pad, tower, a few Space Centre buildings and the runway: anchored at the pad, built in local
   coordinates (x east along the ground, y up, z across). */
function buildPadModel() {
  const g = new THREE.Group();
  const M = (k) => mat(k);
  g.add(box(44, 3, 30, 0, -1.48, 0, M('grey')));
  g.add(box(6, 0.1, 6, 0, 0.03, 0, M('black')));
  const tower = new THREE.Group();
  const red = mat('red');
  for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) tower.add(box(0.3, 34, 0.3, x, 17, z, red));
  for (let y = 2; y < 34; y += 2.6) { tower.add(box(2.9, 0.18, 0.18, 0, y, -1.3, red)); tower.add(box(2.9, 0.18, 0.18, 0, y, 1.3, red)); tower.add(box(0.18, 0.18, 2.9, -1.3, y, 0, red)); tower.add(box(0.18, 0.18, 2.9, 1.3, y, 0, red)); }
  tower.add(box(3.6, 0.5, 1, 2.2, 28, 0, red));
  tower.add(sphere(0.45, 0, 34.4, 0, mat('red', { emissive: new THREE.Color('#ff2010') })));
  tower.position.set(-7.5 - 1.3, 0, -6);
  g.add(tower);
  // Space Centre buildings to the west
  const bld = (x, z, w, h, d, k) => g.add(box(w, h, d, x, h / 2 - 0.5, z, M(k)));
  bld(-160, -40, 60, 26, 40, 'white'); bld(-160, -40, 62, 3, 42, 'dark');
  bld(-260, 30, 40, 14, 30, 'grey'); bld(-90, 70, 24, 40, 24, 'white'); bld(-90, 70, 26, 3, 26, 'red');
  g.userData.anchor = true;
  return g;
}

/* ---------------- planets ---------------- */

/* Height of the ground off the flight plane: exactly the physics terrain at z = 0, blending into other hills
   further out so the land looks natural in every direction. */
function terrainH3(b, phi, z) {
  const h0 = terrainH(b, phi);
  const w = smoothstep(60, 600, Math.abs(z));
  if (w <= 0) return h0;
  const th = z / b.R;
  const h1 = 0.55 * terrainH(b, phi + 1.37 * th + 0.25 * Math.sin(9 * th)) + 0.45 * terrainH(b, phi - 2.1 * th + 0.7);
  return lerp(h0, h1, w);
}

function bodyModel(b) {
  let m = R3.bodies.get(b);
  if (m) return m;
  const g = new THREE.Group();
  let surf;
  if (b.star) {
    surf = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,200,90'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(6, 6, 1);
    g.add(glow);
  } else {
    surf = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), new THREE.MeshStandardMaterial({ map: planetTexture(b), roughness: 0.95, metalness: 0 }));
    surf.rotation.x = Math.PI / 2;
    if (b.atmo) {
      const [r, gg, bb] = hexToRgb(b.sky ? b.sky[1] : '#6eaaff');
      const halo = new THREE.Mesh(new THREE.SphereGeometry(1 + b.atmo.top / b.R, 64, 32),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(r / 255, gg / 255, bb / 255), transparent: true, opacity: 0.18, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(halo);
    }
  }
  g.add(surf);
  m = { g, surf };
  R3.bodies.set(b, m);
  R3.flight.world.add(g);
  return m;
}

/* An equirectangular picture of the whole planet, coloured by height like the 2D view. */
function planetTexture(b) {
  const W = 512, H = 256, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d'), img = x.createImageData(W, H);
  const pal = terrainPalette(b).map(hexToRgbAny), water = hexToRgb(b.colWater || '#2a66ad');
  const gasCols = [[226, 199, 156], [190, 150, 100], [245, 232, 205], [170, 125, 80]];
  for (let j = 0; j < H; j++) {
    const th = (j / (H - 1)) * Math.PI;
    for (let i = 0; i < W; i++) {
      const ph = (i / W) * TAU;
      // Three's sphere vertex direction, turned so the poles point along z
      const vx = -Math.cos(ph) * Math.sin(th), vy = Math.cos(th), vz = Math.sin(ph) * Math.sin(th);
      const wx = vx, wy = -vz, wz = vy;
      const lon = Math.atan2(wy, wx), lat = Math.asin(clamp(wz, -1, 1));
      let col;
      if (b.gas) {
        const k = Math.floor((lat * 9 + Math.sin(lon * 3 + lat * 20) * 0.15 + 9) % 4);
        col = gasCols[(k + 4) % 4];
      } else {
        const h = terrainH3(b, lon, lat * b.R);
        if (b.ocean && h < 0) col = water;
        else col = pal[terrainBucket(b, h)];
      }
      const o = (j * W + i) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.encoding = THREE.sRGBEncoding;
  return t;
}
function hexToRgbAny(c) {
  if (c[0] === '#') return hexToRgb(c);
  const m = c.match(/\d+/g);
  return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
}

/* The ground near the camera: a strip of terrain around the flight plane, rebuilt as the camera moves. */
function updateGround(S, b, focus, dist, alt, bp) {
  const R = b.R;
  const span = Math.min(Math.max(dist * 12, alt * 4, 30000), R * 1.4);
  const Z = Math.min(Math.max(dist * 6, alt * 3, 15000), R * 0.7);
  const show = !b.gas && !b.star && span < R * 1.3 && alt < R * 0.6;
  if (!show) { if (S.ground.mesh) S.ground.mesh.visible = false; if (S.ground.water) S.ground.water.visible = false; return; }
  const phiC = Math.atan2(focus[1] - bp[1], focus[0] - bp[0]);
  const g = S.ground;
  const moved = g.anchor ? Math.hypot(focus[0] - g.anchor[0], focus[1] - g.anchor[1]) : Infinity;
  if (g.body !== b || moved > g.span * 0.08 || Math.abs(Math.log(span / g.span)) > 0.3) {
    g.body = b; g.span = span; g.anchor = [focus[0], focus[1]];
    const NA = 240, NZ = 48, half = span / R;
    // samples bunch up near the middle, where the craft is, and spread out towards the horizon
    const spread = (u) => 0.15 * u + 0.85 * u * Math.abs(u);
    const pos = new Float32Array((NA + 1) * (NZ + 1) * 3), col = new Float32Array((NA + 1) * (NZ + 1) * 3);
    const wpos = b.ocean ? new Float32Array((NA + 1) * (NZ + 1) * 3) : null;
    const pal = terrainPalette(b).map((c) => new THREE.Color().setRGB(...hexToRgbAny(c).map((v) => v / 255)));
    const ax = g.anchor[0] - bp[0], ay = g.anchor[1] - bp[1];
    let k = 0;
    for (let i = 0; i <= NA; i++) {
      const phi = phiC + half * spread((i / NA) * 2 - 1), cp = Math.cos(phi), sp = Math.sin(phi);
      for (let j = 0; j <= NZ; j++) {
        const z = Z * spread((j / NZ) * 2 - 1);
        const h = terrainH3(b, phi, z), th = z / R, ct = Math.cos(th), st = Math.sin(th);
        const r = R + h;
        pos[k * 3] = r * cp * ct - ax; pos[k * 3 + 1] = r * sp * ct - ay; pos[k * 3 + 2] = r * st;
        if (wpos) { wpos[k * 3] = R * cp * ct - ax; wpos[k * 3 + 1] = R * sp * ct - ay; wpos[k * 3 + 2] = R * st; }
        const c = pal[terrainBucket(b, h)];
        const n = 0.92 + 0.08 * Math.sin(phi * 9000 + z * 0.013);
        col[k * 3] = c.r * n; col[k * 3 + 1] = c.g * n; col[k * 3 + 2] = c.b * n;
        k++;
      }
    }
    const idx = [];
    for (let i = 0; i < NA; i++) for (let j = 0; j < NZ; j++) {
      const a = i * (NZ + 1) + j, bb = a + NZ + 1;
      idx.push(a, bb, a + 1, bb, bb + 1, a + 1);
    }
    if (!g.mesh) {
      g.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }));
      g.mesh.frustumCulled = false;
      S.world.add(g.mesh);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.mesh.geometry.dispose();
    g.mesh.geometry = geo;
    if (wpos) {
      if (!g.water) {
        g.water = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: new THREE.Color(b.colWater), roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.88, side: THREE.DoubleSide }));
        g.water.frustumCulled = false;
        S.world.add(g.water);
      }
      g.water.material.color.set(b.colWater);
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
      wg.setIndex(idx);
      wg.computeVertexNormals();
      g.water.geometry.dispose();
      g.water.geometry = wg;
    }
  }
  g.mesh.visible = true;
  g.mesh.position.set(g.anchor[0] - focus[0], g.anchor[1] - focus[1], 0);
  if (g.water) {
    g.water.visible = !!b.ocean;
    g.water.position.copy(g.mesh.position);
  }
}

/* ---------------- flight rendering ---------------- */

function camDist() { return F.H / (2 * Math.tan((R3.fov * Math.PI) / 360) * F.zoom); }

function renderWorld3d() {
  const S = R3.flight, c = F.craft, t = F.t;
  const b = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], t);
  const bp = bodyPos(b, t);
  const focus = c.pos;
  const ux0 = c.pos[0] - bp[0], uy0 = c.pos[1] - bp[1], ul = Math.hypot(ux0, uy0) || 1;
  const up = new THREE.Vector3(ux0 / ul, uy0 / ul, 0);
  const alt = ul - b.R;
  F.viewRot = Math.PI / 2 - Math.atan2(uy0, ux0);
  F.daylight = daylight(c, b, t);
  const r = S.renderer;
  if (r.domElement.width !== Math.round(F.W * r.getPixelRatio()) || r.domElement.height !== Math.round(F.H * r.getPixelRatio())) r.setSize(F.W, F.H, false);

  // camera: swing around the craft (yaw/pitch); "up" points away from the planet
  const dist = camDist();
  const zAxis = new THREE.Vector3(0, 0, 1), right = new THREE.Vector3().crossVectors(zAxis.clone().negate(), up).normalize();
  const cp = Math.cos(R3.pitch), off = zAxis.clone().multiplyScalar(cp * Math.cos(R3.yaw)).add(right.clone().multiplyScalar(cp * Math.sin(R3.yaw))).add(up.clone().multiplyScalar(Math.sin(R3.pitch)));
  S.camera.position.copy(off.multiplyScalar(dist));
  S.camera.up.copy(up);
  S.camera.lookAt(0, 0, 0);
  S.camera.aspect = F.W / F.H;
  S.camera.near = Math.max(0.05, dist * 0.02);
  S.camera.updateProjectionMatrix();

  // sky colour, stars and sunlight
  const sky = b.sky || ['#000006', '#03040c'];
  const sk = b.atmo && b.sky ? Math.pow(Math.max(0, 1 - Math.max(0, alt) / (b.atmo.top * 0.9)), 1.6) * Math.min(1, 0.45 + b.atmo.rho0) : 0;
  const skyMix = sk * F.daylight;
  r.setClearColor(new THREE.Color(mixColor('#02030a', mixColor(sky[0], sky[1], 0.45), skyMix)), 1);
  S.stars.material.opacity = clamp(1 - skyMix * 1.6, 0, 1);
  S.stars.position.copy(S.camera.position);
  const sun = bodyPos(SUN, t);
  const sd = new THREE.Vector3(sun[0] - focus[0], sun[1] - focus[1], 0).normalize();
  S.sun.position.copy(sd.clone().multiplyScalar(1000));
  const shadow = typeof inShadow === 'function' && inShadow(c, t);
  S.sun.intensity = shadow ? 0.08 : 2.2;
  S.amb.intensity = 0.18 + 0.25 * skyMix;
  S.hemi.intensity = 0.1 + 0.4 * skyMix;
  S.hemi.position.copy(up);

  // planets: every body in view, as a sphere
  const pxPerM = F.H / (2 * Math.tan((R3.fov * Math.PI) / 360));
  for (const wb of BODIES) {
    const p = bodyPos(wb, t);
    const dx = p[0] - focus[0], dy = p[1] - focus[1], dd = Math.hypot(dx, dy);
    const big = (wb.R / Math.max(dd, 1)) * pxPerM > 0.6 || wb === b;
    if (!big && !R3.bodies.has(wb)) continue;
    const m = bodyModel(wb);
    m.g.visible = big;
    if (!big) continue;
    m.g.position.set(dx, dy, 0);
    // the near body's sphere sits just under the detailed ground strip
    const rr = wb.star || wb.gas || wb !== b ? wb.R : wb.ocean ? wb.R - 3 : wb.R + wb.hOff - 60;
    m.g.scale.setScalar(rr);
  }
  updateGround(S, b, focus, dist, Math.max(0, alt - Math.max(0, terrainH(b, Math.atan2(uy0, ux0)))), bp);

  // pad, runway and buildings
  const padR = HOME.R + terrainH(HOME, PAD_PHI), hp = bodyPos(HOME, t);
  S.pad.visible = b === HOME && alt < 200000;
  if (S.pad.visible) {
    S.pad.position.set(hp[0] + padR * Math.cos(PAD_PHI) - focus[0], hp[1] + padR * Math.sin(PAD_PHI) - focus[1], 0);
    S.pad.rotation.z = PAD_PHI - Math.PI / 2;
    if (!S.runway) S.runway = buildRunwayModel();
    S.runway.visible = true;
    S.runway.position.set(hp[0] - focus[0], hp[1] - focus[1], 0);
  } else if (S.runway) S.runway.visible = false;

  // clouds
  syncClouds(S, b, focus, alt);
  syncMarkers(S, focus);

  // crafts
  const pressure = atmo(b, alt).p;
  const live = new Set();
  const all = [...F.debris, ...F.others.filter((o) => !o.dead)];
  if (!c.dead) all.push(c);
  for (const k of all) {
    live.add(k);
    const m = craftModel(S.crafts, k);
    if (!m.root.parent) S.world.add(m.root);
    m.root.position.set(k.pos[0] - focus[0], k.pos[1] - focus[1], 0);
    m.root.rotation.z = k.angle - Math.PI / 2;
    m.inner.position.set(-k.xc, -k.yc, 0);
    updateCraftFx(m, k, pressure);
  }
  for (const k of [...S.crafts.keys()]) if (!live.has(k)) dropModel(S.crafts, k, S.world);

  // reentry glow
  if (!c.dead && c.heat > 3e7) {
    const bv = bodyVel(b, t), vx = c.vel[0] - bv[0], vy = c.vel[1] - bv[1], v = Math.hypot(vx, vy) || 1;
    const a = Math.min(0.85, (c.heat - 3e7) / 1.2e8);
    S.plasma.visible = true;
    S.plasma.position.set((vx / v) * c.length * 0.35, (vy / v) * c.length * 0.35, 0);
    S.plasma.scale.setScalar(c.length * 2.2 + 8);
    S.plasma.material.opacity = a;
  } else S.plasma.visible = false;

  // particles
  fillParticles(S.smoke, F.particles, 'smoke', focus);
  fillParticles(S.fire, F.particles, 'fire', focus);
  const sc = (F.H / (2 * Math.tan((R3.fov * Math.PI) / 360))) * r.getPixelRatio();
  S.smoke.points.material.uniforms.scale.value = sc;
  S.fire.points.material.uniforms.scale.value = sc;

  r.render(S.scene, S.camera);

  // the 2D canvas on top only shows a marker when the craft is too small to see
  const ctx = F.ctx;
  ctx.clearRect(0, 0, F.W, F.H);
  if (!c.dead && c.length * F.zoom < 5) {
    ctx.save();
    ctx.translate(F.W / 2, F.H / 2);
    ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

function buildRunwayModel() {
  const g = new THREE.Group();
  const R = HOME.R + 4.06, a0 = PAD_PHI - RUNWAY_START, a1 = PAD_PHI - RUNWAY_END, N = 60, W = 22;
  const pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const a = lerp(a0, a1, i / N);
    for (const z of [-W, W]) pos.push(R * Math.cos(a), R * Math.sin(a), z);
    if (i < N) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const geo = new THREE.BufferGeometry();
  // positions relative to the planet centre are large; shift them to the runway's middle for precision
  const mid = [R * Math.cos((a0 + a1) / 2), R * Math.sin((a0 + a1) / 2)];
  for (let i = 0; i < pos.length; i += 3) { pos[i] -= mid[0]; pos[i + 1] -= mid[1]; }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const strip = new THREE.Mesh(geo, mat('dark', { roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
  strip.position.set(mid[0], mid[1], 0);
  g.add(strip);
  // centre-line dashes
  const len = (a0 - a1) * R;
  for (let s = 40; s < len - 40; s += 60) {
    const a = a0 - (s + 12) / R;
    const d = box(25, 0.08, 0.8, 0, 0, 0, mat('white', { roughness: 0.6 }));
    d.position.set(R * Math.cos(a), R * Math.sin(a), 0);
    d.rotation.z = a - Math.PI / 2;
    d.position.x += 0.06 * Math.cos(a); d.position.y += 0.06 * Math.sin(a);
    g.add(d);
  }
  // the dashes hold planet-sized coordinates; fine for a short-lived few boxes near home
  return (R3.flight.world.add(g), g);
}

/* Things standing on the ground near the craft (survey beacons, and more later), kept in step each frame. */
function buildMarker(m) {
  const g = new THREE.Group();
  if (m.kind === 'beacon') {
    const hgt = m.air ? m.hi : 400;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, hgt, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x7dffa8, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = hgt / 2;
    const base = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), new THREE.MeshBasicMaterial({ color: 0x7dffa8 }));
    g.add(beam, base);
    g.userData.thick = [beam, base]; // widened when seen from far away
  } else if (typeof buildAnomaly === 'function') g.add(buildAnomaly(m));
  return g;
}
function syncMarkers(S, focus) {
  if (!S.markers) { S.markers = new THREE.Group(); S.world.add(S.markers); S.markerObjs = new Map(); }
  const want = typeof surfaceMarkers === 'function' ? surfaceMarkers() : [], seen = new Set();
  for (const m of want) {
    seen.add(m.key);
    let o = S.markerObjs.get(m.key);
    if (!o) { o = buildMarker(m); S.markerObjs.set(m.key, o); S.markers.add(o); }
    const bp = bodyPos(m.body, F.t), r = m.body.R + groundAlt(m.body, m.phi);
    o.position.set(bp[0] + r * Math.cos(m.phi) - focus[0], bp[1] + r * Math.sin(m.phi) - focus[1], 0);
    o.rotation.set(0, 0, m.phi - Math.PI / 2);
    if (o.userData.thick) {
      const k = Math.max(1, S.camera.position.distanceTo(o.position) / 350);
      for (const t of o.userData.thick) t.scale.set(k, t === o.userData.thick[0] ? 1 : k, k);
    }
  }
  for (const [k, o] of S.markerObjs) if (!seen.has(k)) { S.markers.remove(o); disposeObj(o); S.markerObjs.delete(k); }
}

function syncClouds(S, b, focus, alt) {
  const show = b === HOME && alt < 30000;
  S.clouds.visible = show;
  if (!show) return;
  if (!S.clouds.children.length) {
    const rnd = rng3(99);
    for (const cl of F.clouds) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTexture(), transparent: true, opacity: 0.8, depthWrite: false }));
      sp.userData.cl = cl;
      sp.userData.z = (rnd() - 0.5) * 9000;
      S.clouds.add(sp);
    }
  }
  const hp = bodyPos(HOME, F.t);
  for (const sp of S.clouds.children) {
    const cl = sp.userData.cl, r = HOME.R + cl.alt, th = sp.userData.z / HOME.R;
    sp.position.set(hp[0] + r * Math.cos(cl.phi) * Math.cos(th) - focus[0], hp[1] + r * Math.sin(cl.phi) * Math.cos(th) - focus[1], r * Math.sin(th));
    sp.scale.set(cl.w * 2.2, cl.h * 3, 1);
    sp.material.opacity = 0.75 * (0.35 + 0.65 * F.daylight);
  }
}

/* Flames, parachutes, RCS puffs and heat glow on one craft. */
function updateCraftFx(m, k, pressure) {
  const fx = m.fx;
  while (fx.children.length) {
    const o = fx.children.pop();
    o.traverse((x) => {
      if (x.geometry && !x.userData.shared) x.geometry.dispose();
      if (x.material) x.material.dispose();
    });
  }
  const flick = 0.9 + Math.random() * 0.2;
  for (const p of k.parts) {
    if (p.burn > 0 && isEngine(p.def)) {
      const d = p.def, bw = flameHalfWidth(d), vac = 1 - clamp(pressure, 0, 1);
      const L = (2.5 + 6 * p.burn) * (1 + 1.6 * vac) * Math.pow(d.thrust / 150, 0.35) * flick * (d.jet ? 0.6 : 1);
      const w1 = bw * (0.6 + 2.2 * vac);
      const col = d.jet ? 0xff9050 : d.kind === 'ion' ? 0x6aa8ff : d.nuclear ? 0x9adcff : d.kind === 'srb' ? 0xffa040 : 0xffc080;
      const outer = new THREE.Mesh(flameGeo(), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: d.jet ? 0.35 : 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
      outer.userData.shared = true;
      outer.scale.set(Math.max(w1, bw), L, Math.max(w1, bw));
      const inner = new THREE.Mesh(flameGeo(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: d.jet ? 0.25 : 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      inner.userData.shared = true;
      inner.scale.set(bw * 0.5, L * 0.4, bw * 0.5);
      const y0 = p.inv ? p.top : p.bot, dir = p.inv ? -1 : 1;
      for (const f of [outer, inner]) { f.position.set(p.x, y0, 0); if (dir < 0) f.rotation.z = Math.PI; fx.add(f); }
    }
    if (p.def.chute && p.open && p.area > 1) fx.add(canopyModel(p));
    // heat glow
    const built = m.parts.get(p.uid);
    if (built) {
      const a = p.temp > 800 ? clamp((p.temp - 800) / (partMaxTemp(p.def) - 800), 0, 1) : 0;
      if (a > 0.01 || built.glow) {
        built.glow = a > 0.01;
        for (const mm of built.mats) if (mm.emissive) mm.emissive.setRGB(a * 1.2, a * (0.45 - 0.3 * a), a * 0.1);
      }
    }
  }
  if (k.rcsFiring > 0.05) {
    for (const p of k.rcsParts) {
      const s = p.flip ? -1 : 1;
      const puff = new THREE.Mesh(puffGeo(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
      puff.userData.shared = true;
      puff.position.set(p.x + s * (p.def.w / 2 + 0.35), (p.top + p.bot) / 2, 0);
      puff.scale.setScalar(0.25 + Math.random() * 0.2);
      fx.add(puff);
    }
  }
}
let _flameGeo = null, _puffGeo = null;
/* A cone whose wide end is at the nozzle (y = 0) and whose tip points down to y = -1. */
function flameGeo() {
  if (!_flameGeo) { _flameGeo = new THREE.ConeGeometry(1, 1, 16, 1, true); _flameGeo.rotateZ(Math.PI); _flameGeo.translate(0, -0.5, 0); }
  return _flameGeo;
}
function puffGeo() { return _puffGeo || (_puffGeo = new THREE.SphereGeometry(1, 10, 8)); }

function canopyModel(p) {
  const g = new THREE.Group();
  const s = Math.sqrt(p.area) * 0.6, L = s * 1.1 + 2;
  const x0 = p.x + (p.def.radial ? (p.flip ? -1 : 1) * s * 0.6 : 0), y0 = p.top;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(s, 24, 10, 0, TAU, 0, Math.PI / 2.4), mat(p.def.drogue ? 'drogue' : 'chute', { side: THREE.DoubleSide }));
  dome.position.set(x0, y0 + L - s * 0.25, 0);
  dome.scale.y = 0.75;
  g.add(dome);
  const pts = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; pts.push(p.x, y0, 0, x0 + Math.cos(a) * s * 0.92, y0 + L, Math.sin(a) * s * 0.92); }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.8 })));
  return g;
}

function fillParticles(P, list, kind, focus) {
  let n = 0;
  for (const p of list) {
    if (p.kind !== kind || n >= PARTICLE_MAX) continue;
    if (p.z === undefined) p.z = (Math.random() - 0.5) * 2;
    P.pos[n * 3] = p.x - focus[0]; P.pos[n * 3 + 1] = p.y - focus[1]; P.pos[n * 3 + 2] = p.z;
    const a = p.life / p.max;
    if (kind === 'smoke') { P.col[n * 4] = 0.84; P.col[n * 4 + 1] = 0.84; P.col[n * 4 + 2] = 0.86; P.col[n * 4 + 3] = a * 0.4; }
    else { P.col[n * 4] = 1; P.col[n * 4 + 1] = (100 + 120 * a) / 255; P.col[n * 4 + 2] = 0.16; P.col[n * 4 + 3] = a; }
    P.size[n] = p.size * 2;
    n++;
  }
  P.g.setDrawRange(0, n);
  P.g.attributes.position.needsUpdate = true;
  P.g.attributes.color4.needsUpdate = true;
  P.g.attributes.size.needsUpdate = true;
}

/* Which part of the active craft is under the mouse (3D picking). */
function pick3d(c, sx, sy) {
  const S = R3.flight, m = S && S.crafts.get(c);
  if (!m) return null;
  const v = new THREE.Vector2((sx / F.W) * 2 - 1, -(sy / F.H) * 2 + 1);
  S.raycaster.setFromCamera(v, S.camera);
  const hits = S.raycaster.intersectObject(m.inner, true);
  for (const h of hits) {
    const u = h.object.userData.uid;
    if (u != null && c.byUid.has(u)) return c.byUid.get(u);
  }
  return null;
}

/* Swing the flight camera with a drag (right button, or left on empty space). */
function wireCamera3d() {
  const cv = document.getElementById('game');
  let drag = null;
  cv.addEventListener('contextmenu', (e) => { if (gfx3d()) e.preventDefault(); });
  cv.addEventListener('pointerdown', (e) => {
    if (!gfx3d() || !F.running || F.map) return;
    const onPart = e.button === 0 && partAt(F.craft, e.clientX, e.clientY);
    if (e.button === 2 || (e.button === 0 && !onPart)) drag = { x: e.clientX, y: e.clientY, yaw: R3.yaw, pitch: R3.pitch, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    R3.yaw = drag.yaw - dx * 0.008;
    R3.pitch = clamp(drag.pitch + dy * 0.008, -1.45, 1.45);
  });
  window.addEventListener('pointerup', () => { drag = null; });
  cv.addEventListener('dblclick', () => { if (gfx3d() && !F.map) { R3.yaw = 0; R3.pitch = 0.12; } });
}

/* ---------------- hangar ---------------- */

function setupHangarScene() {
  const S = R3.hangar;
  S.scene = new THREE.Scene();
  S.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 5000);
  const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(3, 4, 6);
  const fill = new THREE.DirectionalLight(0x9fc0ff, 0.6); fill.position.set(-5, 1, 2);
  const rim = new THREE.DirectionalLight(0xffe0c0, 0.7); rim.position.set(0, 3, -6);
  S.scene.add(key, fill, rim, new THREE.AmbientLight(0x8090a0, 0.55));
  S.crafts = new Map();
  S.floor = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: 0x0b1018, roughness: 1, metalness: 0, transparent: true, opacity: 0.85 }));
  S.floor.rotation.x = -Math.PI / 2;
  S.scene.add(S.floor);
}

/* Draw the hangar's craft in 3D, lined up exactly with the 2D view (v) so building still works. */
function drawHangar3d(craft, v, W, H, loose = []) {
  const S = R3.hangar, r = S.renderer;
  if (r.domElement.width !== Math.round(W * r.getPixelRatio()) || r.domElement.height !== Math.round(H * r.getPixelRatio())) r.setSize(W, H, false);
  r.setClearColor(0x000000, 0);
  if (!craft && S.crafts.has(R3.hangarKey)) dropModel(S.crafts, R3.hangarKey, S.scene);
  const key = R3.hangarKey || (R3.hangarKey = {});
  if (craft) {
    // one model that keeps its parts between redraws and only rebuilds the ones that changed
    Object.assign(key, { parts: craft.parts, shells: craft.shells, byUid: craft.byUid });
    const m = craftModel(S.crafts, key, 0.3);
    if (!m.root.parent) S.scene.add(m.root);
    m.root.position.set(0, 0, 0); m.root.rotation.set(0, 0, 0); m.inner.position.set(0, 0, 0);
    const b = craft.bounds;
    S.floor.visible = true;
    S.floor.position.set((b.minX + b.maxX) / 2, Math.min(b.minY, ...craft.legs.map((l) => l.footY)) - 0.05, 0);
    S.floor.scale.setScalar(Math.max(b.maxX - b.minX, 3) * 0.75);
  } else S.floor.visible = false;
  // pieces set aside on the floor: one model each, kept between redraws like the rocket's
  const keys = R3.hangarLoose || (R3.hangarLoose = []);
  loose.forEach((c, i) => {
    const k = keys[i] || (keys[i] = {});
    Object.assign(k, { parts: c.parts, shells: c.shells, byUid: c.byUid });
    const m = craftModel(S.crafts, k, 0.3);
    if (!m.root.parent) S.scene.add(m.root);
    m.root.position.set(0, 0, 0); m.root.rotation.set(0, 0, 0); m.inner.position.set(0, 0, 0);
  });
  for (const k of keys.splice(loose.length)) dropModel(S.crafts, k, S.scene);
  const cx = craft ? (craft.bounds.minX + craft.bounds.maxX) / 2 : 0, cy = craft ? (craft.bounds.minY + craft.bounds.maxY) / 2 : 0;
  const sx = v.ox + cx * v.s, sy = v.oy - cy * v.s;
  const cam = S.camera;
  cam.left = -sx / v.s; cam.right = (W - sx) / v.s; cam.top = sy / v.s; cam.bottom = (sy - H) / v.s;
  const cp = Math.cos(R3.hPitch);
  cam.position.set(cx + 500 * cp * Math.sin(R3.hYaw), cy + 500 * Math.sin(R3.hPitch), 500 * cp * Math.cos(R3.hYaw));
  cam.up.set(0, 1, 0);
  cam.lookAt(cx, cy, 0);
  cam.updateProjectionMatrix();
  r.render(S.scene, cam);
}
function hangarRotated() { return gfx3d() && (Math.abs(R3.hYaw) > 1e-3 || Math.abs(R3.hPitch) > 1e-3); }

/* ---------------- 3D part icons ---------------- */

function partIcon3d(canvas, id, W, H) {
  if (!R3.icons) {
    const cv = document.createElement('canvas');
    R3.icons = { renderer: new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }), scene: new THREE.Scene(), cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100), store: new Map() };
    const I = R3.icons;
    I.renderer.outputEncoding = THREE.sRGBEncoding;
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 4, 6);
    I.scene.add(key, new THREE.AmbientLight(0x9aa8c0, 0.7));
  }
  const I = R3.icons, def = PART_DEFS[id];
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  I.renderer.setPixelRatio(dpr);
  I.renderer.setSize(W, H, false);
  const p = { uid: 1, id, def, x: 0, top: 0, bot: -def.h, flip: false, inv: false, fuel: def.fuel || 0, solid: def.solid || 0, mono: def.mono || 0, ablator: def.ablator || 0, cfg: {} };
  if (def.kind === 'legs') { p.footX = 1.3; p.footY = -def.h - 0.9; }
  const host = { x: -0.6, top: 0.5, bot: -def.h - 0.5, def: { w: 1.2, h: def.h + 1 } };
  const built = buildPart(p, { byUid: new Map([[undefined, host]]) });
  if (def.wing) { built.obj.position.set(0, 0, 0); built.obj.rotation.set(0, -0.4, 0); }
  const objs = [built.obj];
  if (def.fairing) { p.shell = true; p.cfg = { fairH: 2.2 }; objs.push(buildShell(p, 0.55)); }
  const grp = new THREE.Group();
  for (const o of objs) grp.add(o);
  grp.rotation.y = def.wing ? 0 : 0.45;
  grp.rotation.x = 0.18;
  I.scene.add(grp);
  const bb = new THREE.Box3().setFromObject(grp), size = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
  const k = Math.max(size.x / W, size.y / H) * 1.12;
  I.cam.left = -W * k / 2; I.cam.right = W * k / 2; I.cam.top = H * k / 2; I.cam.bottom = -H * k / 2;
  I.cam.position.set(ctr.x, ctr.y, ctr.z + 50); I.cam.lookAt(ctr); I.cam.updateProjectionMatrix();
  I.renderer.setClearColor(0x000000, 0);
  I.renderer.render(I.scene, I.cam);
  I.scene.remove(grp);
  disposeObj(grp);
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const x = canvas.getContext('2d');
  x.clearRect(0, 0, canvas.width, canvas.height);
  x.drawImage(I.renderer.domElement, 0, 0, canvas.width, canvas.height);
}
