'use strict';
/* Rocketwright — the comms network. Antennas reach a set distance; three ground stations on Verdan listen for them.
   Two points can talk when they are within the shorter of their two ranges and no world is in the way. Relay
   antennas pass signals on, so a chain of relay satellites can reach places the ground can't see. When the
   network is switched on (new careers, or in Settings), a probe with no crew needs a signal to be controlled,
   and transmitting science always needs one. */

const PROBE_RANGE = 2.5e6;                    // a probe core's own little antenna
const STATION_RANGE = [2e10, 1e11, 4e11];     // ground stations, by Tracking Station level
const STATION_PHIS = [PAD_PHI, PAD_PHI + TAU / 3, PAD_PHI - TAU / 3];
const STATION_NAMES = ['Space Centre', 'Far Hills Station', 'Coast Station'];

function commnetOn() { return !!(Career.s && Career.s.commnet) && !(typeof F !== 'undefined' && F.tutorial); }

/* How far a set of parts can talk, and how far it can relay. */
function partsRange(parts) {
  let r = 0, relay = 0;
  for (const p of parts) {
    const d = p.def || PART_DEFS[p.id];
    if (!d) continue;
    if (d.range) r = Math.max(r, d.range);
    if (d.relay) relay = Math.max(relay, d.range);
    if (d.probe) r = Math.max(r, PROBE_RANGE);
  }
  return { r, relay };
}
const rangeCache = new Map();
function vesselRange(v) {
  const key = v.id + ':' + v.parts.length;
  if (!rangeCache.has(key)) rangeCache.set(key, partsRange(v.parts));
  return rangeCache.get(key);
}

function stationNodes(t) {
  const lv = Career.s ? facLevel(Career.s, 'tracking') : 3, hp = bodyPos(HOME, t);
  return STATION_PHIS.map((phi, i) => {
    const r = HOME.R + groundAlt(HOME, phi) + 30;
    return { name: STATION_NAMES[i], pos: [hp[0] + r * Math.cos(phi), hp[1] + r * Math.sin(phi)], range: STATION_RANGE[lv - 1], ground: true };
  });
}

/* Is the straight line from a to b clear of every world? */
function lineClear(a, b, bodies) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  for (const { p, R } of bodies) {
    let k = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
    k = clamp(k, 0, 1);
    const cx = a[0] + dx * k - p[0], cy = a[1] + dy * k - p[1];
    if (cx * cx + cy * cy < R * R) return false;
  }
  return true;
}

/* Find a path from craft c to a ground station (fewest hops). */
function linkToHome(c, t) {
  const me = partsRange(c.parts);
  if (!me.r) return { ok: false, why: 'No antenna or probe core' };
  const nodes = [{ name: 'you', pos: c.pos, range: me.r }];
  for (const o of (typeof F !== 'undefined' && F.others) || []) {
    if (o.dead || o === c) continue;
    const pr = partsRange(o.parts);
    if (pr.relay) nodes.push({ name: o.meta ? o.meta.name : 'relay', pos: o.pos, range: pr.relay });
  }
  const s = typeof universe === 'function' ? universe() : null;
  for (const v of (s && s.vessels) || []) {
    const pr = vesselRange(v);
    if (pr.relay) nodes.push({ name: v.name, pos: [v.s[0], v.s[1]], range: pr.relay });
  }
  nodes.push(...stationNodes(t));
  // a world blocks the line below its lowest ground (so craft in a deep basin still count as outside it)
  const bodies = BODIES.map((b) => ({ p: bodyPos(b, t), R: b.R + Math.min(0, b.star || b.gas ? 0 : biomeLevels(b).min) - 5 }));
  const prev = new Array(nodes.length).fill(-1), seen = new Array(nodes.length).fill(false);
  seen[0] = true;
  const q = [0];
  let end = -1;
  while (q.length && end < 0) {
    const i = q.shift(), a = nodes[i];
    for (let j = 1; j < nodes.length; j++) {
      if (seen[j]) continue;
      const b = nodes[j];
      const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]);
      if (d > Math.min(a.range, b.range) || !lineClear(a.pos, b.pos, bodies)) continue;
      seen[j] = true; prev[j] = i;
      if (b.ground) { end = j; break; }
      q.push(j);
    }
  }
  if (end < 0) return { ok: false, why: 'Out of range of the ground stations and any relays' };
  const chain = [];
  for (let k = end; k >= 0; k = prev[k]) chain.unshift(nodes[k]);
  const first = chain[1], d0 = Math.hypot(first.pos[0] - c.pos[0], first.pos[1] - c.pos[1]);
  const strength = clamp(1 - d0 / Math.min(me.r, first.range), 0, 1);
  return { ok: true, path: chain.map((n) => n.pos.slice()), via: chain.slice(1, -1).map((n) => n.name), station: chain[chain.length - 1].name, strength };
}

/* Can the craft being flown send and receive right now? (Always yes when the network is off.) */
function hasSignal() { return !commnetOn() || !F.comm || F.comm.ok; }

function signalText() {
  const k = F.comm;
  if (!k) return '';
  if (!k.ok) return 'None';
  const bars = Math.max(1, Math.ceil(k.strength * 4));
  return `${'▮'.repeat(bars)}${'▯'.repeat(4 - bars)} ${k.via.length ? `via ${k.via[0]}${k.via.length > 1 ? ` +${k.via.length - 1}` : ''}` : k.station}`;
}
