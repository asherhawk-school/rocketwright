'use strict';
/* Rocketwright — contracts. Offers are generated from templates with the save's seeded RNG, scale with
   how far you've got, pay an advance on accepting, a reward on completion, and a penalty if they expire. */

const OFFER_COUNT = 4;
const SURVEY_GROUND_R = 400, SURVEY_AIR_R = 1500;   // m from a survey site that counts as visiting it
const SITE_WORDS = ['Amber', 'Birch', 'Cobalt', 'Dune', 'Ember Ridge', 'Flint', 'Garnet', 'Heron', 'Iris', 'Juniper', 'Kestrel Rock', 'Lumen'];
const OFFER_LIFETIME = 30 * DAY;
const r100 = (x) => Math.round(x / 100) * 100;

/* Which worlds contracts may send you to, based on what you've achieved. */
function reachableBodies(s) {
  const m = s.milestones, has = (ids) => ids.some((k) => m[k]);
  const out = [HOME];
  if (m.orbit) out.push(MOON);
  if (has(['orbit_pallid', 'land_pallid'])) out.push(CINDER, OCHRE, PIP, SHARD);
  if (has(['soi_ochre', 'soi_cinder', 'soi_pip', 'soi_shard'])) out.push(TEMPEST, GALE, EMBER, FROST, GLACIS);
  if (has(['soi_tempest', 'soi_glacis', 'soi_gale', 'soi_ember', 'soi_frost'])) out.push(UMBRA);
  return out;
}
const maxActive = (s) => facLimit(s, 'mission');

function validSits(b, s) {
  const out = [];
  if (b.atmo) out.push('flyingLow', 'flyingHigh');
  if (b !== HOME || s.milestones.space) out.push('spaceLow', 'spaceHigh');
  if (b !== HOME && !b.gas) out.push('landed');
  return out;
}

function contractBuilders(s) {
  const m = s.milestones, bodies = reachableBodies(s).filter((b) => !b.star);
  const away = bodies.filter((b) => b !== HOME);
  const f = (b) => BODY_SCI[b.id] || 1;
  const B = [];
  if (!m.space) B.push([3, () => {
    const km = pick(s, [5, 10, 20, 35, 50, 70].filter((k) => k >= (m.alt10k ? 20 : 5)));
    return { type: 'altitude', title: `Reach ${km} km`, desc: `Fly a craft above ${km} km over Verdan.`, p: { km },
      reward: r100(2000 + km * 180), sci: Math.round(2 + km / 10), rep: 2, days: 30 };
  }]);
  const testable = Object.keys(PART_DEFS).filter((id) => partUnlocked(id) && activatable(PART_DEFS[id]));
  if (testable.length) B.push([2, () => {
    const id = pick(s, testable), def = PART_DEFS[id];
    let w;
    if (def.chute) w = { altMin: 200, altMax: 4000, maxSpeed: 250, label: 'below 4 km over Verdan, slower than 250 m/s' };
    else {
      const ws = [{ altMin: 2000, altMax: 12000, label: 'between 2 and 12 km over Verdan' },
        { altMin: 15000, altMax: 40000, label: 'between 15 and 40 km over Verdan' }];
      if (m.space) ws.push({ altMin: 70000, altMax: 250000, label: 'in space near Verdan (70 to 250 km)' });
      w = pick(s, ws);
    }
    return { type: 'test', title: `Test the ${def.name}`, desc: `Stage the ${def.name} ${w.label}.`, p: { part: id, ...w },
      reward: r100(3500 + rand(s) * 3500 + (w.altMin / 1000) * 50), sci: 4, rep: 2, days: 40 };
  }]);
  B.push([2, () => {
    const b = pick(s, bodies), sits = validSits(b, s);
    if (!sits.length) return null;
    const sit = pick(s, sits);
    return { type: 'science', title: `Science ${SITUATIONS[sit].label.toLowerCase()} ${b.name}`,
      desc: `Transmit or recover any experiment result taken ${SITUATIONS[sit].label.toLowerCase()} ${b.name}.`, p: { body: b.id, sit },
      reward: r100(5000 * (1 + f(b) * 0.7)), sci: Math.round(6 + 3 * f(b)), rep: 3 + f(b), days: 30 + 60 * f(b) };
  }]);
  // science from one biome: landed (or splashed down) there, or flying low over it
  const withBiomes = bodies.filter((b) => BIOMES[b.id] && (b !== HOME || m.alt10k));
  if (withBiomes.length) B.push([1.5, () => {
    const b = pick(s, withBiomes), d = BIOMES[b.id];
    const biome = pick(s, biomeNames(b).filter((n) => n !== d.spot));
    const sit = biome === d.sea ? 'splashed' : b.atmo && rand(s) < 0.4 ? 'flyingLow' : 'landed';
    const k = b === HOME ? 0.6 : 1 + f(b) * 0.9;
    return { type: 'science', title: `Science ${SITUATIONS[sit].label.toLowerCase()} ${b.name}'s ${biome}`,
      desc: `Transmit or recover any experiment result taken ${SITUATIONS[sit].label.toLowerCase()} the ${biome} biome of ${b.name}.`, p: { body: b.id, sit, biome },
      reward: r100(6000 * k), sci: Math.round(5 + 3 * f(b)), rep: 3 + f(b), days: 30 + 60 * f(b) };
  }]);
  // surveys: visit a few marked sites, on the ground or flying over them
  const surveyable = bodies.filter((b) => !b.gas && (b === HOME || m['land_' + b.id] || m['orbit_' + b.id]));
  B.push([1.6, () => {
    const b = pick(s, surveyable.length ? surveyable : [HOME]);
    const air = !!b.atmo && rand(s) < (b === HOME ? 0.6 : 0.35);
    // near the Space Centre at home (a rover or plane trip), anywhere elsewhere
    const c0 = b === HOME ? PAD_PHI + (rand(s) < 0.5 ? -1 : 1) * (40000 + rand(s) * 120000) / b.R : rand(s) * TAU;
    const n = 2 + Math.floor(rand(s) * 3), word = pick(s, SITE_WORDS);
    const sites = [];
    for (let i = 0; i < n; i++) {
      // spread out, at least 4 km apart
      let phi = c0;
      for (let k = 0; k < 30; k++) {
        phi = c0 + ((rand(s) - 0.5) * 2 * Math.min(25000, b.R * 0.08)) / b.R;
        if (sites.every((o) => Math.abs(wrapPi(o.phi - phi)) * b.R > 4000)) break;
      }
      // ground sites go on land, not in the sea
      for (let k = 0; k < 20 && !air && b.ocean && terrainH(b, phi) < 2; k++) phi += 2000 / b.R;
      sites.push({ name: `${word} ${i + 1}`, phi: wrapPi(phi) });
    }
    const lo = air ? (b === HOME ? 1000 : 2000) : 0, hi = air ? lo + 4000 + Math.round(rand(s) * 4) * 1000 : 0;
    const what = air ? `Fly over ${n} marked sites on ${b.name} between ${fmtNum(lo / 1000)} and ${fmtNum(hi / 1000)} km above the ground`
      : `Land (or walk) within ${SURVEY_GROUND_R} m of ${n} marked sites on ${b.name}`;
    const k = b === HOME ? 0.5 : 1 + f(b);
    return { type: 'survey', title: `Survey ${word} on ${b.name}`, desc: `${what}. The HUD points to the nearest one; beacons mark them up close.`,
      p: { body: b.id, sites, air, lo, hi, done: [] }, reward: r100((air ? 9000 : 11000) * k + 1500 * n), sci: Math.round(4 + 2 * f(b) * n / 2), rep: 3 + f(b), days: 40 + 60 * f(b) };
  }]);
  // tourists who pay to see space, orbit, or visit Pallid
  if (m.liftoff) B.push([1.3, () => {
    const goals = [['space', 'see space', 1]];
    if (m.space) goals.push(['orbit', 'orbit Verdan', 2]);
    if (m.orbit) goals.push(['flyby:pallid', 'fly by Pallid', 3.5]);
    if (m.land_pallid) goals.push(['land:pallid', 'land on Pallid', 6]);
    const [goal, label, k] = pick(s, goals);
    const taken = new Set(s.crew.map((c) => c.name).concat(s.contracts.filter((c) => c.type === 'tourism').flatMap((c) => c.p.names)));
    const free = TOURIST_NAMES.filter((n) => !taken.has(n));
    const n = Math.min(free.length, 1 + Math.floor(rand(s) * 3));
    if (!n) return null;
    const names = [];
    for (let i = 0; i < n; i++) names.push(free.splice(Math.floor(rand(s) * free.length), 1)[0]);
    return { type: 'tourism', title: `Tourists: ${label} (${n})`, p: { names, goal },
      desc: `${names.join(', ')} will pay to ${label}${goal === 'space' ? ' (above 70 km)' : ''}. Take ${n > 1 ? 'them all in one flight' : 'them'} and bring them home safely. Tourists can't fly, so take a pilot (they fill the free seats) or a probe core.`,
      reward: r100(4000 * k * n + 3000), sci: 0, rep: 2 + n, days: 60 + 30 * k };
  }]);
  // space stations and surface bases
  if (m.orbit && s.tech.includes('docking')) B.push([0.9, () => {
    const b = pick(s, bodies.filter((x) => x === HOME || m['orbit_' + x.id] || m['soi_' + x.id]));
    const seats = 3 + Math.floor(rand(s) * 4);
    return { type: 'station', title: `Space station at ${b.name}`, p: { body: b.id, seats },
      desc: `Build a station in a stable orbit around ${b.name} with at least ${seats} seats, a docking port, solar panels or fuel cells, and an antenna. Dock modules together in orbit if you need to.`,
      reward: r100(30000 * (1 + f(b)) + 4000 * seats), sci: 10, rep: 10 + f(b), days: 120 + 60 * f(b) };
  }]);
  const baseable = away.filter((b) => !b.gas && m['land_' + b.id]);
  if (baseable.length) B.push([0.8, () => {
    const b = pick(s, baseable), seats = 2 + Math.floor(rand(s) * 3);
    return { type: 'base', title: `Surface base on ${b.name}`, p: { body: b.id, seats },
      desc: `Land a base on ${b.name} with at least ${seats} seats, solar panels or fuel cells, and an antenna.`,
      reward: r100(40000 * (1 + f(b)) + 5000 * seats), sci: 12, rep: 12 + f(b), days: 150 + 60 * f(b) };
  }]);
  const orbitable = bodies.filter((b) => b !== HOME || !m.orbit);
  if (orbitable.length) B.push([2, () => {
    const b = pick(s, orbitable);
    return { type: 'orbit', title: `Orbit ${b.name}`, desc: `Reach a stable orbit around ${b.name}${b.atmo ? ', above its atmosphere' : ''}.`, p: { body: b.id },
      reward: r100(12000 * (1 + f(b))), sci: Math.round(8 + 4 * f(b)), rep: 5 + 2 * f(b), days: 30 + 60 * f(b) };
  }]);
  if (away.length) {
    B.push([1.5, () => {
      const b = pick(s, away);
      return { type: 'flyby', title: `Fly by ${b.name}`, desc: `Enter ${b.name}'s sphere of influence.`, p: { body: b.id },
        reward: r100(7000 * (1 + f(b))), sci: Math.round(5 + 3 * f(b)), rep: 3 + f(b), days: 40 + 60 * f(b) };
    }]);
    const landable = away.filter((b) => !b.gas);
    if (landable.length) B.push([1.5, () => {
      const b = pick(s, landable), d = BIOMES[b.id];
      // sometimes a particular biome
      const biome = d && rand(s) < 0.4 ? pick(s, biomeNames(b).filter((n) => n !== d.sea && n !== d.spot)) : null;
      if (biome) return { type: 'land', title: `Land in ${b.name}'s ${biome}`, desc: `Touch down safely in the ${biome} biome of ${b.name}.`, p: { body: b.id, biome },
        reward: r100(20000 * (1 + f(b))), sci: Math.round(12 + 5 * f(b)), rep: 7 + 2 * f(b), days: 40 + 70 * f(b) };
      return { type: 'land', title: `Land on ${b.name}`, desc: `Touch down safely on ${b.name}.`, p: { body: b.id },
        reward: r100(16000 * (1 + f(b))), sci: Math.round(10 + 5 * f(b)), rep: 6 + 2 * f(b), days: 40 + 70 * f(b) };
    }]);
    if (landable.length) B.push([1, () => {
      const b = pick(s, landable);
      return { type: 'flag', title: `Plant a flag on ${b.name}`, desc: `Land a crewed craft on ${b.name}, send an astronaut outside (J) and plant a flag (L).`,
        p: { body: b.id }, reward: r100(20000 * (1 + f(b))), sci: Math.round(8 + 4 * f(b)), rep: 8 + 2 * f(b), days: 50 + 70 * f(b) };
    }]);
  }
  if (m.orbit) B.push([1.2, () => {
    const used = new Set(s.crew.map((c) => c.name).concat((s.vessels || []).flatMap((v) => (v.crew || []).map((x) => x.name)),
      s.contracts.filter((c) => c.type === 'rescue').map((c) => c.p.crewName)));
    const name = CREW_POOL.find((n) => !used.has(n) && rand(s) < 0.5) || CREW_POOL.find((n) => !used.has(n));
    if (!name) return null;
    const b = reachableBodies(s).includes(MOON) && rand(s) < 0.35 ? MOON : HOME;
    const alt = Math.round(((b.atmo ? b.atmo.top + 15000 : 15000) + rand(s) * b.R * 0.3) / 1000) * 1000;
    return { type: 'rescue', title: `Rescue ${name}`,
      desc: `${name} is stuck in a capsule orbiting ${b.name} at ${fmtNum(alt / 1000)} km. Dock with it using a docking port, then bring them home and recover them.`,
      p: { crewName: name, body: b.id, alt }, reward: r100(25000 * (1 + (BODY_SCI[b.id] || 1) * 0.6)), sci: 10, rep: 10, days: 60 + 60 * (BODY_SCI[b.id] || 1) };
  }]);
  if (m.orbit) B.push([1, () => {
    const b = pick(s, bodies);
    const lo = Math.round(((b.atmo ? b.atmo.top : b.R * 0.05) + rand(s) * b.R * 0.4) / 10000) * 10;
    const hi = lo + Math.round((b.R * (0.25 + rand(s) * 0.4)) / 10000) * 10;
    return { type: 'satellite', title: `Satellite around ${b.name}`,
      desc: `Put a craft with an antenna into orbit around ${b.name} with periapsis above ${fmtNum(lo)} km and apoapsis below ${fmtNum(hi)} km.`,
      p: { body: b.id, lo: lo * 1000, hi: hi * 1000 }, reward: r100(10000 * (1 + f(b))), sci: 5, rep: 4 + f(b), days: 40 + 60 * f(b) };
  }]);
  if (m.orbit && s.tech.includes('grappling')) B.push([0.8, () => ({ type: 'asteroid', title: 'Capture an asteroid',
    desc: 'Grab one of the asteroids passing Verdan with a claw and put it in a stable orbit with apoapsis below 2,000 km.',
    p: { body: HOME.id, maxAp: 2e6 }, reward: r100(60000), sci: 25, rep: 15, days: 120 })]);
  if (m.orbit && s.tech.includes('comms')) B.push([1, () => {
    const b = pick(s, bodies);
    return { type: 'relay', title: `Relay satellite at ${b.name}`, desc: `Put a craft with a relay antenna into a stable orbit around ${b.name}.`,
      p: { body: b.id }, reward: r100(14000 * (1 + f(b))), sci: 6, rep: 5 + f(b), days: 50 + 60 * f(b) };
  }]);
  return B;
}

function genContract(s) {
  const B = contractBuilders(s);
  const taken = new Set(s.contracts.filter((c) => c.state === 'offered' || c.state === 'active').map((c) => c.title));
  for (let tries = 0; tries < 12; tries++) {
    const total = B.reduce((a, b) => a + b[0], 0);
    let r = rand(s) * total, mk = B[0][1];
    for (const [w, fn] of B) { if ((r -= w) <= 0) { mk = fn; break; } }
    const c = mk();
    if (!c || taken.has(c.title)) continue;
    c.id = s.contractSeq++;
    c.state = 'offered';
    c.advance = r100(c.reward * 0.15);
    c.penalty = r100(c.reward * 0.3);
    c.offeredAt = s.ut;
    c.expires = s.ut + OFFER_LIFETIME;
    return c;
  }
  return null;
}

/* Fail overdue contracts, drop stale offers and top the offer board back up. Returns failed contracts. */
function refreshContracts(s) {
  const failed = [];
  for (const c of s.contracts) {
    if (c.state === 'active' && s.ut > c.deadline) { failContract(s, c); failed.push(c); }
    if (c.state === 'offered' && s.ut > c.expires) c.state = 'expired';
  }
  s.contracts = s.contracts.filter((c) => c.state !== 'expired' && c.state !== 'declined');
  while (s.contracts.filter((c) => c.state === 'offered').length < OFFER_COUNT) {
    const c = genContract(s);
    if (!c) break;
    s.contracts.push(c);
  }
  // keep the history short
  const old = s.contracts.filter((c) => c.state === 'done' || c.state === 'failed');
  if (old.length > 30) { const drop = new Set(old.slice(0, old.length - 30)); s.contracts = s.contracts.filter((c) => !drop.has(c)); }
  return failed;
}

function acceptContract(s, id) {
  const c = s.contracts.find((x) => x.id === id && x.state === 'offered');
  if (!c) return 'No such offer';
  if (s.contracts.filter((x) => x.state === 'active').length >= maxActive(s)) return `You can run ${maxActive(s)} contracts at once. Earn reputation for more.`;
  c.state = 'active';
  c.deadline = s.ut + c.days * DAY;
  s.funds += c.advance;
  if (c.type === 'rescue') c.p.vid = spawnStranded(s, BODY_BY_ID[c.p.body], c.p.alt, c.p.crewName, rand(s) * TAU).id;
  // tourists arrive at the Space Centre and wait for a seat
  if (c.type === 'tourism') for (const name of c.p.names) s.crew.push({ id: nextCrewId(s), name, role: 'tourist', status: 'available', flights: 0, worlds: [], contract: c.id });
  return null;
}
function declineContract(s, id) {
  const c = s.contracts.find((x) => x.id === id && x.state === 'offered');
  if (c) c.state = 'declined';
}
/* Did a flight give tourists what they paid for? */
function touristGoalMet(goal, flags) {
  const [k, body] = goal.split(':');
  if (k === 'space') return !!flags.space || (flags.maxAlt || 0) > 70000;
  if (k === 'orbit') return (flags.orbited || []).includes('verdan');
  if (k === 'flyby') return (flags.visited || []).includes(body);
  if (k === 'land') return (flags.landedOn || []).includes(body);
  return false;
}
/* Tourists go home when their contract ends, one way or the other. */
function touristsLeave(s, c) {
  if (c.type !== 'tourism') return;
  for (const t of s.crew) if (t.role === 'tourist' && t.contract === c.id && t.status !== 'lost') t.status = 'left';
}

function completeContract(s, c) {
  touristsLeave(s, c);
  c.state = 'done';
  c.doneAt = s.ut;
  let funds = c.reward * ((s.diff && s.diff.funds) || 1) * (hasStrategy('bargains', s) ? 0.9 : 1);
  let sci = c.sci * ((s.diff && s.diff.science) || 1);
  if (hasStrategy('fundraising', s)) { funds += sci * 0.5 * 1000; sci *= 0.5; }
  if (hasStrategy('outreach', s)) { sci += (funds * 0.2) / 1500; funds *= 0.8; }
  c.paid = { funds: Math.round(funds), sci: Math.round(sci * 10) / 10 };
  s.funds += Math.round(funds);
  s.science = Math.round((s.science + sci) * 10) / 10;
  s.rep = clamp(s.rep + c.rep * (hasStrategy('publicity', s) ? 1.5 : 1), -100, 1000);
}
function failContract(s, c) {
  touristsLeave(s, c);
  c.state = 'failed';
  if (c.type === 'rescue' && s.vessels) s.vessels = s.vessels.filter((v) => !(v.crew || []).some((x) => x.name === c.p.crewName && x.stranded));
  s.funds -= c.penalty;
  s.rep = clamp(s.rep - c.rep, -100, 1000);
}

/* Check active contracts against something that just happened in flight. Returns the ones completed.
   ev: { kind: 'tick'|'stage'|'land'|'science', body, alt, speed, orbit, landed, hasAntenna, partIds, sit } */
function checkContracts(s, ev) {
  const done = [];
  for (const c of s.contracts) {
    if (c.state !== 'active') continue;
    const p = c.p, b = ev.body;
    let ok = false;
    switch (c.type) {
      case 'altitude': ok = ev.kind === 'tick' && b === HOME && ev.alt >= p.km * 1000; break;
      case 'test': ok = ev.kind === 'stage' && b === HOME && ev.alt >= p.altMin && ev.alt <= p.altMax &&
        (!p.maxSpeed || ev.speed <= p.maxSpeed) && ev.partIds.includes(p.part); break;
      case 'flyby': ok = ev.kind === 'tick' && b.id === p.body; break;
      case 'orbit': ok = ev.kind === 'tick' && b.id === p.body && stableOrbit(ev, b); break;
      case 'land': ok = ev.kind === 'land' && b.id === p.body && (!p.biome || ev.biome === p.biome); break;
      case 'science': ok = ev.kind === 'science' && b.id === p.body && ev.sit === p.sit && (!p.biome || ev.biome === p.biome); break;
      case 'asteroid': ok = ev.kind === 'tick' && b === HOME && ev.hasAsteroid && stableOrbit(ev, b) && ev.orbit.ra - b.R < p.maxAp; break;
      case 'survey': {
        if (ev.kind !== 'tick' || b.id !== p.body || ev.phi === undefined) break;
        for (let i = 0; i < p.sites.length; i++) {
          if (p.done.includes(i)) continue;
          const d = Math.abs(wrapPi(ev.phi - p.sites[i].phi)) * b.R;
          const hit = p.air ? !ev.landed && d < SURVEY_AIR_R && ev.radar >= p.lo && ev.radar <= p.hi : ev.landed && d < SURVEY_GROUND_R;
          if (hit) { p.done.push(i); if (ev.hits) ev.hits.push(`${p.sites[i].name} surveyed (${p.done.length}/${p.sites.length})`); }
        }
        ok = p.done.length === p.sites.length;
        break;
      }
      case 'tourism': ok = ev.kind === 'recover' && p.names.every((n) => (ev.crew || []).includes(n)) && touristGoalMet(p.goal, ev.flags || {}); break;
      case 'station': ok = ev.kind === 'tick' && b.id === p.body && stableOrbit(ev, b) && ev.seats >= p.seats && ev.hasDock && ev.hasPower && ev.hasAntenna; break;
      case 'base': ok = ev.kind === 'tick' && b.id === p.body && ev.landed && ev.seats >= p.seats && ev.hasPower && ev.hasAntenna; break;
      case 'relay': ok = ev.kind === 'tick' && b.id === p.body && ev.hasRelay && stableOrbit(ev, b); break;
      case 'flag': ok = ev.kind === 'flag' && b.id === p.body; break;
      case 'rescue': ok = ev.kind === 'recover' && (ev.crew || []).includes(p.crewName); break;
      case 'satellite': ok = ev.kind === 'tick' && b.id === p.body && ev.hasAntenna && stableOrbit(ev, b) &&
        ev.orbit.rp - b.R >= p.lo && ev.orbit.ra - b.R <= p.hi; break;
    }
    if (ok) { completeContract(s, c); done.push(c); }
  }
  return done;
}
function stableOrbit(ev, b) {
  const o = ev.orbit;
  return !!o && !ev.landed && o.e < 1 && o.rp - b.R > (b.atmo ? b.atmo.top : 3000);
}
