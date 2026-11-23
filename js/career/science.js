'use strict';
/* Rocketwright — science. An experiment run in a situation (body × where you are) gives a result.
   Transmitting it home pays half of what's left of that subject; recovering it pays all of what's left. */

const EXPERIMENTS = {
  crew: { name: 'Crew Report', base: 5 },
  thermo: { name: 'Temperature Scan', base: 6 },
  baro: { name: 'Pressure Scan', base: 8 },
  jar: { name: 'Sample Canister', base: 14, oneShot: true },
  seismic: { name: 'Seismic Scan', base: 20, sits: ['landed'] },
  sniffer: { name: 'Air Sample', base: 16, sits: ['flyingLow', 'flyingHigh'] },
  // collected by astronauts on a spacewalk, and carried (several at once) until transmitted or recovered
  evaReport: { name: 'Spacewalk Report', base: 8 },
  sample: { name: 'Surface Sample', base: 30, sits: ['landed', 'splashed'] },
};
const SITUATIONS = {
  landed: { label: 'Landed on', mult: 1.5 },
  splashed: { label: 'Splashed down on', mult: 1.3 },
  flyingLow: { label: 'Flying low over', mult: 1.0 },
  flyingHigh: { label: 'Flying high over', mult: 1.1 },
  spaceLow: { label: 'In space near', mult: 1.3 },
  spaceHigh: { label: 'In space high over', mult: 1.0 },
};
/* How valuable science is at each world. */
const BODY_SCI = { helion: 10, cinder: 7, verdan: 1, pallid: 4, ochre: 6, pip: 7, shard: 7, tempest: 8, gale: 9, ember: 9, frost: 9, glacis: 10, umbra: 12 };
const TRANSMIT_FRACTION = 0.5;

function spaceHighAlt(b) { return b.star ? 3e9 : Math.max(b.R * 0.5, b.atmo ? b.atmo.top * 2 : 0); }

/* Where the craft is, for science purposes. */
function situationOf(c, b, t) {
  if (c.landed) {
    const bp = bodyPos(b, t);
    const h = terrainH(b, Math.atan2(c.pos[1] - bp[1], c.pos[0] - bp[0]));
    return b.ocean && h < 0 ? 'splashed' : 'landed';
  }
  const bp = bodyPos(b, t);
  const alt = Math.hypot(c.pos[0] - bp[0], c.pos[1] - bp[1]) - b.R;
  if (b.atmo && alt < b.atmo.top) return alt < b.atmo.top * 0.35 ? 'flyingLow' : 'flyingHigh';
  return alt < spaceHighAlt(b) ? 'spaceLow' : 'spaceHigh';
}

/* Situations where it matters which biome you're in. */
const BIOME_SITS = new Set(['landed', 'splashed', 'flyingLow']);
function sciBiome(c, b, t, sit) {
  if (!BIOME_SITS.has(sit)) return null;
  const bp = bodyPos(b, t);
  return biomeAt(b, Math.atan2(c.pos[1] - bp[1], c.pos[0] - bp[0]));
}
function sitText(sit, b, bio) { return `${SITUATIONS[sit].label} ${b.name}${bio ? ` (${bio})` : ''}`; }

function subjectId(exp, b, sit, bio) { return `${exp}@${b.id}:${sit}` + (bio ? `:${bio}` : ''); }
function subjectCap(exp, b, sit) { return EXPERIMENTS[exp].base * (BODY_SCI[b.id] || 1) * SITUATIONS[sit].mult; }
function subjectLeft(s, id, cap) { return cap * (1 - (s.sci[id] || 0)); }
function subjectLabel(exp, b, sit, bio) { return `${EXPERIMENTS[exp].name} · ${sitText(sit, b, bio)}`; }

function expWorks(exp, b, sit) {
  const e = EXPERIMENTS[exp];
  if (!e || (e.sits && !e.sits.includes(sit))) return false;
  if (exp === 'sniffer' && !b.atmo) return false;
  if (b.star && (sit === 'landed' || sit === 'splashed')) return false;
  return true;
}
function canRun(p, b, sit) {
  if (!EXPERIMENTS[p.def.exp] || p.result || p.spent) return false;
  return expWorks(p.def.exp, b, sit);
}

/* An astronaut collects a result and carries it (in p.held); one per subject. */
function collectResult(s, p, exp, b, sit, bio) {
  const id = subjectId(exp, b, sit, bio);
  p.held = p.held || [];
  if (!expWorks(exp, b, sit) || p.held.some((r) => r.id === id)) return null;
  const cap = subjectCap(exp, b, sit);
  const r = { id, exp, body: b.id, sit, biome: bio || null, cap, label: subjectLabel(exp, b, sit, bio) };
  p.held.push(r);
  return { value: subjectLeft(s, id, cap), result: r };
}
function transmitHeld(s, p, i, bonus = 1) {
  const r = (p.held || [])[i];
  if (!r) return null;
  p.held.splice(i, 1);
  return { gain: creditResult(s, r, TRANSMIT_FRACTION, bonus), result: r };
}
/* Every result a part has: its own experiment's, and any carried ones. */
function partResults(p) { return (p.result ? [p.result] : []).concat(p.held || []); }

/* Run the experiment on part p; stores the result on the part. */
function runExperiment(s, p, b, sit, bio) {
  const exp = p.def.exp;
  const cap = subjectCap(exp, b, sit);
  const id = subjectId(exp, b, sit, bio);
  p.result = { id, exp, body: b.id, sit, biome: bio || null, cap, label: subjectLabel(exp, b, sit, bio) };
  return { value: subjectLeft(s, id, cap), result: p.result };
}

/* Credit a result. fraction 1 = recovered, TRANSMIT_FRACTION = transmitted. Returns science gained. */
function creditResult(s, r, fraction, bonus = 1) {
  const done = s.sci[r.id] || 0;
  const gain = r.cap * (1 - done) * fraction * bonus * ((s.diff && s.diff.science) || 1);
  s.sci[r.id] = done + (1 - done) * fraction;
  if (s.mode === 'career') s.science = Math.round((s.science + gain) * 10) / 10;
  return gain;
}
/* A scientist aboard adds to every result: 10%, plus 5% per rank. */
function scienceBonus(s, crew) {
  if (!s || s.mode !== 'career') return 1;
  let b = 1;
  for (const x of crew || []) {
    const cm = x.id && s.crew.find((k) => k.id === x.id);
    if (cm && roleOf(cm) === 'scientist') b = Math.max(b, 1.1 + 0.05 * crewRank(cm));
  }
  return b;
}

function transmit(s, p, bonus = 1) {
  if (!p.result) return 0;
  const gain = creditResult(s, p.result, TRANSMIT_FRACTION, bonus);
  const r = p.result;
  p.result = null;
  if (EXPERIMENTS[r.exp].oneShot) p.spent = true;
  return { gain, result: r };
}
