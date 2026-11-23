'use strict';
/* Rocketwright — asteroids. Every so often the Tracking Station spots a rock on a long, looping orbit round Verdan.
   It stays for a few weeks, then drifts away, unless you grab it with a claw. Rocks come in five sizes (A to E),
   are full of ore a drill can dig out once you hold on to them, and contracts pay to bring one into orbit. */

const ROCK_CLASSES = ['A', 'B', 'C', 'D', 'E'];
const ROCK_MAX = 3;                    // rocks in the sky at once
const ROCK_GAP = 6 * 86400;            // how often a new one turns up (6 days)
const ROCK_STAY = [25 * 86400, 60 * 86400];

/* Make up a rock and its orbit round Verdan: periapsis a few hundred km up, apoapsis out towards Pallid. */
function spawnAsteroid(s) {
  if (!s.vessels) { s.vessels = []; s.vesselSeq = 1; }
  const cls = ROCK_CLASSES[Math.min(4, Math.floor(rand(s) * rand(s) * 5 + rand(s) * 1.2))];
  const c = new Craft(layoutDesign({ parts: [{ uid: 1, id: 'rock' + cls, parent: null }] }));
  c.recompute();
  const rock = c.parts[0];
  rock.ore = rock.def.rockOre * (0.6 + rand(s) * 0.4);
  c.updateMass();
  const rp = HOME.R + HOME.atmo.top + 150000 + rand(s) * 1500000, ra = 3.5e6 + rand(s) * 4e6;
  const th = rand(s) * TAU, dir = rand(s) < 0.5 ? 1 : -1;
  const v = Math.sqrt(HOME.mu * (2 / ra - 2 / (ra + rp)));
  c.pos = [ra * Math.cos(th), ra * Math.sin(th)];
  c.vel = [-dir * v * Math.sin(th), dir * v * Math.cos(th)];
  c.angle = rand(s) * TAU;
  c.angVel = (rand(s) - 0.5) * 0.04;
  const code = `${String.fromCharCode(65 + Math.floor(rand(s) * 26))}${String.fromCharCode(65 + Math.floor(rand(s) * 26))}-${100 + Math.floor(rand(s) * 900)}`;
  const rec = vesselFromCraft(c, s.ut, { id: s.vesselSeq++, name: `Rock ${code}`, crew: [], kind: 'asteroid', launchT: s.ut,
    flags: { space: true, maxAlt: 0, visited: [], landedOn: [] } });
  rec.expires = s.ut + ROCK_STAY[0] + rand(s) * (ROCK_STAY[1] - ROCK_STAY[0]);
  rec.rockClass = cls;
  s.vessels.push(rec);
  s.nextRock = s.ut + ROCK_GAP * (0.6 + rand(s) * 0.8);
  return rec;
}

/* Let rocks drift away when their time is up, and spot new ones. Rocks you've let go of stay for good. */
function asteroidTick(s) {
  if (!s || !s.vessels) return [];
  const gone = s.vessels.filter((v) => v.kind === 'asteroid' && v.expires && s.ut > v.expires);
  if (gone.length) s.vessels = s.vessels.filter((v) => !gone.includes(v));
  if (s.nextRock === undefined) s.nextRock = s.ut + DAY;
  let n = 0;
  while (s.ut >= s.nextRock && s.vessels.filter((v) => v.kind === 'asteroid' && v.expires).length < ROCK_MAX && n++ < ROCK_MAX) spawnAsteroid(s);
  if (s.ut >= s.nextRock) s.nextRock = s.ut + ROCK_GAP;
  return gone;
}

/* An asteroid held by a craft: its drills dig from the rock instead of the ground. */
function heldRock(c) { return c.parts.find((p) => p.def.asteroid && (p.ore || 0) > 1e-6) || null; }
