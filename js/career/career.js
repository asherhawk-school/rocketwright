'use strict';
/* Rocketwright — the saved game: mode (sandbox or career), time, money, reputation, crew and progress.
   Everything here is plain data and DOM-free so it can be tested headless. */

const SAVE_VERSION = 1;
const START_FUNDS = 25000;
const DAY = 86400;

const CREW_POOL = [
  'Mira Kestrell', 'Tobin Ashford', 'Lena Quill', 'Rafe Corran', 'Juno Marsh', 'Odile Brandt', 'Silas Venn', 'Priya Hale',
  'Corin Dace', 'Wren Holloway', 'Nadia Frost', 'Emeric Pell', 'Tamsin Rook', 'Ivo Larch', 'Bea Calder', 'Hollis Grey',
];

const Career = { s: null, listeners: [] };

function newSave(mode, seed) {
  const s = {
    v: SAVE_VERSION, mode, ut: 0, funds: mode === 'career' ? START_FUNDS : 0, science: 0, rep: 0,
    tech: ['start'], contracts: [], contractSeq: 1, rng: (seed >>> 0) || 0x9e3779b9,
    crew: [], hired: 0, sci: {}, milestones: {}, created: Date.now(), flights: 0,
  };
  if (mode === 'career') for (let i = 0; i < 3; i++) hireCrew(s, true);
  return s;
}

const isCareer = () => !!(Career.s && Career.s.mode === 'career');
function setSave(s) { Career.s = s; persist(); }
function persist() {
  if (!Career.s) return;
  if (Career.noPersist) { for (const f of Career.listeners) f(); return; } // tutorials don't touch your save
  Store.set('save', Career.s);
  for (const f of Career.listeners) f();
}
function loadSave() {
  const s = Store.get('save', null);
  Career.s = s && s.v === SAVE_VERSION ? s : null;
  return Career.s;
}
function onCareerChange(f) { Career.listeners.push(f); }

/* Deterministic random numbers (mulberry32), state kept in the save so contracts are reproducible. */
function rand(s) {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (s, arr) => arr[Math.floor(rand(s) * arr.length)];

/* ---------- money & reputation ---------- */

function addFunds(x) { if (!isCareer()) return; Career.s.funds = Math.round(Career.s.funds + x); }
function addScience(x) { if (!isCareer()) return; Career.s.science = Math.round((Career.s.science + x) * 10) / 10; }
function addRep(x) { if (!isCareer()) return; Career.s.rep = clamp(Career.s.rep + x, -100, 1000); }
const fmtFunds = (x) => '¤' + fmtNum(Math.round(x));
function fmtDate(ut) {
  const d = Math.floor(ut / DAY), h = Math.floor((ut % DAY) / 3600), m = Math.floor((ut % 3600) / 60);
  return `Year ${Math.floor(d / 110) + 1}, day ${(d % 110) + 1} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/* ---------- parts & costs ---------- */

function partUnlocked(id) {
  if (!isCareer()) return true;
  const node = PART_TECH[id];
  return !node || Career.s.tech.includes(node);
}
function designCost(d) { return d.parts.reduce((a, p) => a + (PART_DEFS[p.id] ? PART_DEFS[p.id].cost : 0), 0); }
function lockedParts(d) { return [...new Set(d.parts.filter((p) => !partUnlocked(p.id)).map((p) => p.id))]; }

/* What a recovered part is worth: tanks lose the value of the fuel you burned. */
function partValue(p) {
  const d = p.def;
  if (d.fuel) return d.cost * (0.35 + 0.65 * (p.fuel / d.fuel));
  if (d.solid) return d.cost * (0.4 + 0.6 * (p.solid / d.solid));
  if (d.exp === 'jar' && p.spent) return d.cost * 0.8;
  return d.cost;
}
/* Recovery pays less the further you land from the launch site. */
function recoveryFactor(phi, water) {
  const d = Math.abs(wrapPi(phi - PAD_PHI));
  const f = d < 0.004 ? 1 : clamp(0.98 - (d / Math.PI) * 0.9, 0.08, 0.98);
  return water ? f * 0.9 : f;
}

/* ---------- crew ---------- */

function hireCost(s) { return 8000 + 4000 * Math.max(0, s.hired - 3); }
function hireCrew(s, free) {
  const used = new Set(s.crew.map((c) => c.name));
  const name = CREW_POOL.find((n) => !used.has(n)) || `Recruit ${s.crew.length + 1}`;
  if (!free) { if (s.funds < hireCost(s)) return null; s.funds -= hireCost(s); }
  const c = { id: s.crew.length + 1, name, status: 'available', flights: 0, worlds: [] };
  s.crew.push(c);
  s.hired++;
  return c;
}
const availableCrew = (s) => s.crew.filter((c) => c.status === 'available');
function crewRank(c) { return Math.min(5, Math.floor(c.flights / 2) + c.worlds.length); }

/* ---------- milestones pay in career ---------- */

function milestoneReward(id) {
  const [k, bid] = id.split('_');
  const f = bid ? (BODY_SCI[bid] || 1) : 1;
  const base = { liftoff: 1000, alt10k: 2000, space: 5000, orbit: 10000, splash: 4000 }[id];
  if (base) return { funds: base, rep: 2 };
  return { funds: { soi: 4000, orbit: 8000, land: 12000, return: 15000 }[k] * f, rep: 3 + f };
}
