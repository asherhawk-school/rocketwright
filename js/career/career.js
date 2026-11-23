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
  s.levels = Object.fromEntries(Object.keys(FACILITIES).map((k) => [k, mode === 'career' ? 1 : 3]));
  s.commnet = mode === 'career'; // probes need a signal (can be changed in Settings)
  s.diff = { ...DIFF_DEFAULTS };
  s.strategies = [];
  if (mode === 'career') for (const r of ROLE_ORDER) hireCrew(s, true, r);
  return s;
}
/* Bring an older save up to date: roles for astronauts, and building levels (older careers start at level 2). */
function migrateSave(s) {
  for (const c of s.crew || []) if (!c.role) c.role = ROLE_ORDER[(c.id - 1) % 3];
  if (s.commnet === undefined) s.commnet = false; // older games keep flying as before
  s.diff = { ...DIFF_DEFAULTS, ...(s.diff || {}) };
  if (!s.levels) s.levels = Object.fromEntries(Object.keys(FACILITIES).map((k) => [k, s.mode === 'career' ? 2 : 3]));
  for (const k of Object.keys(FACILITIES)) if (!s.levels[k]) s.levels[k] = s.mode === 'career' ? 1 : 3; // buildings added later
  if (!s.strategies) s.strategies = [];
  return s;
}

/* ---------- difficulty ----------
   heat: how strongly reentry heats parts; crash: how hard a landing parts can take; funds and science: reward
   multipliers; revert: whether flights can be reverted and quick-saved. Changed in Settings. */
const DIFF_DEFAULTS = { heat: 1, crash: 1, funds: 1, science: 1, revert: true };
function diff(k) { const d = Career.s && Career.s.diff; return d && d[k] !== undefined ? d[k] : DIFF_DEFAULTS[k]; }

/* ---------- Space Centre buildings ----------
   Each has three levels. Upgrading costs money and lifts a limit. Sandbox games have everything at level 3. */
const FACILITIES = {
  hangar: { name: 'Hangar', icon: '🚀', costs: [40000, 220000], limit: [30, 255, Infinity], what: (x) => isFinite(x) ? `Craft of up to ${x} parts` : 'No part limit' },
  pad: { name: 'Launch Pad & Runway', icon: '🛫', costs: [50000, 280000], limit: [18, 140, Infinity], what: (x) => isFinite(x) ? `Craft up to ${x} t` : 'No mass limit' },
  mission: { name: 'Mission Control', icon: '📋', costs: [30000, 180000], limit: [2, 7, 20], what: (x) => `${x} active contracts` },
  tracking: { name: 'Tracking Station', icon: '🛰️', costs: [35000, 200000], limit: [8, 9, 10],
    what: (x, lv) => `${lv < 2 ? 'No manoeuvre nodes' : 'Manoeuvre nodes'} · time warp up to ${fmtNum(WARP_STEPS[x])}×` },
  astro: { name: 'Astronaut Office', icon: '👩‍🚀', costs: [20000, 120000], limit: [5, 12, Infinity], what: (x) => isFinite(x) ? `Up to ${x} astronauts` : 'Any number of astronauts' },
  admin: { name: 'Administration', icon: '🏛️', costs: [25000, 150000], limit: [1, 2, 3], what: (x) => `${x} active ${x > 1 ? 'strategies' : 'strategy'}` },
  lab: { name: 'Research Lab', icon: '🔬', costs: [30000, 200000], limit: [100, 300, Infinity], what: (x) => isFinite(x) ? `Research nodes costing up to ⚗ ${x}` : 'Research any node' },
};
const WARP_STEPS = [1, 2, 3, 4, 10, 50, 100, 1000, 10000, 100000, 1000000];
function facLevel(s, id) { return !s || s.mode !== 'career' ? 3 : (s.levels && s.levels[id]) || 1; }
function facLimit(s, id) { return FACILITIES[id].limit[facLevel(s, id) - 1]; }
function upgradeCost(s, id) { const lv = facLevel(s, id); return lv >= 3 ? null : FACILITIES[id].costs[lv - 1]; }
function upgradeFacility(s, id) {
  const cost = upgradeCost(s, id);
  if (cost == null) return 'Already fully upgraded';
  if (s.funds < cost) return `Needs ${fmtFunds(cost)}`;
  s.funds -= cost;
  s.levels = s.levels || {};
  s.levels[id] = facLevel(s, id) + 1;
  return null;
}

/* ---------- strategies (Administration) ----------
   Standing policies that trade one kind of reward for another. Each costs money to start, and the
   Administration building's level sets how many can run at once. Cancelling one gives no refund. */
const STRATEGIES = {
  fundraising: { name: 'Fundraising Drive', icon: '💰', cost: 15000, desc: 'Half the science from contracts is paid as money instead (¤1,000 per science).' },
  outreach: { name: 'Science Outreach', icon: '📚', cost: 15000, desc: 'A fifth of the money from contracts becomes science instead (1 science per ¤1,500).' },
  bargains: { name: 'Bulk Buying', icon: '🏷️', cost: 25000, desc: 'Parts cost 15% less, but contracts pay 10% less money.' },
  recovery: { name: 'Recovery Teams', icon: '🚁', cost: 20000, desc: 'Recovered craft return 15% more of their value (never more than all of it).' },
  patents: { name: 'Patent Licensing', icon: '📜', cost: 20000, desc: 'Every research node you unlock also pays ¤300 for each science it cost.' },
  publicity: { name: 'Publicity Tours', icon: '📣', cost: 30000, desc: 'Contracts and milestones earn half as much reputation again.' },
};
function hasStrategy(k, s = Career.s) { return !!(s && s.mode === 'career' && (s.strategies || []).includes(k)); }
function startStrategy(s, k) {
  const st = STRATEGIES[k];
  if (!st) return 'Unknown strategy';
  s.strategies = s.strategies || [];
  if (s.strategies.includes(k)) return 'Already running';
  if (s.strategies.length >= facLimit(s, 'admin')) return 'Upgrade Administration to run more strategies at once';
  if (s.funds < st.cost) return `Needs ${fmtFunds(st.cost)}`;
  s.funds -= st.cost;
  s.strategies.push(k);
  return null;
}
function stopStrategy(s, k) { s.strategies = (s.strategies || []).filter((x) => x !== k); }

/* ---------- astronaut roles ---------- */
const ROLES = {
  pilot: { name: 'Pilot', icon: '🧭', desc: 'Unlocks SAS modes as they gain rank: prograde and retrograde, then radial and manoeuvre, then target.' },
  engineer: { name: 'Engineer', icon: '🔧', desc: 'Repacks used or torn parachutes once you\'re down, and runs drills and converters better.' },
  scientist: { name: 'Scientist', icon: '🧪', desc: 'Resets used experiments so they can be run again, and adds to the science you collect.' },
  tourist: { name: 'Tourist', icon: '🎒', desc: 'A paying passenger. Can\'t fly the craft or go outside.' },
};
const ROLE_ORDER = ['pilot', 'engineer', 'scientist'];
const roleOf = (c) => (c && c.role) || 'pilot';

const isCareer = () => !!(Career.s && Career.s.mode === 'career');
function setSave(s) {
  Career.s = s;
  if (typeof clearCheckpoint === 'function') clearCheckpoint(); // a new or imported game starts with no flight in progress
  if (typeof clearQuickSave === 'function') clearQuickSave();
  persist();
}
function persist() {
  if (!Career.s) return;
  if (Career.noPersist) { for (const f of Career.listeners) f(); return; } // tutorials don't touch your save
  Store.set('save', Career.s);
  for (const f of Career.listeners) f();
}
function loadSave() {
  const s = Store.get('save', null);
  Career.s = s && s.v === SAVE_VERSION ? migrateSave(s) : null;
  // tidy up after a game that was closed mid-flight
  if (Career.s && !(typeof F !== 'undefined' && F.running) && typeof restoreCheckpoint === 'function') {
    const cp = restoreCheckpoint(Career.s);
    const fixed = repairCrew(Career.s);
    if (cp || fixed) {
      Store.set('save', Career.s);
      Career.restoreNote = cp && cp.active ? `Your last flight was interrupted. ${cp.active.name} is waiting in the Tracking Station.`
        : fixed ? `${fixed} astronaut${fixed > 1 ? 's were' : ' was'} stuck after an interrupted flight and ${fixed > 1 ? 'are' : 'is'} available again.` : null;
    }
  }
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
function designCost(d) {
  const c = d.parts.reduce((a, p) => a + (PART_DEFS[p.id] ? PART_DEFS[p.id].cost : 0), 0);
  return Math.round(hasStrategy('bargains') ? c * 0.85 : c);
}
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
  let f = d < 0.004 ? 1 : clamp(0.98 - (d / Math.PI) * 0.9, 0.08, 0.98);
  if (water) f *= 0.9;
  return hasStrategy('recovery') ? Math.min(1, f * 1.15) : f;
}

/* ---------- crew ---------- */

function hireCost(s) { return 8000 + 4000 * Math.max(0, s.hired - 3); }
function hireCrew(s, free, role) {
  const used = new Set(s.crew.map((c) => c.name));
  const name = CREW_POOL.find((n) => !used.has(n)) || `Recruit ${s.crew.length + 1}`;
  if (!free) {
    if (rosterSize(s) >= facLimit(s, 'astro')) return null;
    if (s.funds < hireCost(s)) return null;
    s.funds -= hireCost(s);
  }
  const c = { id: nextCrewId(s), name, role: ROLES[role] ? role : ROLE_ORDER[s.crew.length % 3], status: 'available', flights: 0, worlds: [] };
  s.crew.push(c);
  s.hired++;
  return c;
}
/* Astronauts ready to fly (tourists only ride along, in seats left over). */
const availableCrew = (s) => s.crew.filter((c) => c.status === 'available' && c.role !== 'tourist');
const waitingTourists = (s) => s.crew.filter((c) => c.status === 'available' && c.role === 'tourist');
/* Astronauts on the books (not lost, not tourists): what the Astronaut Office has room for. */
const rosterSize = (s) => s.crew.filter((c) => c.status !== 'lost' && c.status !== 'left' && c.role !== 'tourist').length;
const nextCrewId = (s) => s.crew.reduce((m, c) => Math.max(m, c.id), 0) + 1;
const TOURIST_NAMES = ['Opal Wrenfield', 'Barnaby Quist', 'Delphine Moss', 'Augustin Pell', 'Clementine Ash', 'Rufus Thornby', 'Marisol Vane',
  'Percival Hart', 'Ottilie Brook', 'Lazlo Fenwick', 'Imogen Calloway', 'Theo Marchbank', 'Winifred Sallow', 'Cosmo Dunmore'];
function crewRank(c) { return Math.min(5, Math.floor(c.flights / 2) + c.worlds.length); }

/* ---------- milestones pay in career ---------- */

function milestoneReward(id) {
  if (id.startsWith('anomaly_')) { const a = ANOMALY_BY_ID[id.slice(8)]; return { funds: 10000 * (BODY_SCI[a ? a.body : ''] || 1) * diff('funds'), rep: 8 * (hasStrategy('publicity') ? 1.5 : 1) }; }
  const [k, bid] = id.split('_');
  const f = bid ? (BODY_SCI[bid] || 1) : 1;
  const base = { liftoff: 1000, alt10k: 2000, space: 5000, orbit: 10000, splash: 4000 }[id];
  const rp = hasStrategy('publicity') ? 1.5 : 1;
  if (base) return { funds: base * diff('funds'), rep: 2 * rp };
  return { funds: { soi: 4000, orbit: 8000, land: 12000, return: 15000, flag: 6000 }[k] * f * diff('funds'), rep: (3 + f) * rp };
}
