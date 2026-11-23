'use strict';
/* Rocketwright — docking. Two free docking ports facing each other, close together and nearly at rest
   relative to each other, join their craft into one. Undocking splits them again. */

const DOCK_DIST = 0.7;      // m between port tips
const DOCK_SPEED = 1.0;     // m/s relative speed
const DOCK_ALIGN = 0.94;    // cos of the allowed misalignment (~20°)

/* +1 if the port's open face points along the craft's +y, -1 if along -y. */
function portFacing(c, p) {
  const mid = (p.top + p.bot) / 2;
  for (const u of p.links) {
    const q = c.byUid.get(u);
    if (q) return (q.top + q.bot) / 2 > mid ? -1 : 1;
  }
  return 1;
}
/* A port is free when only one part is attached to it. */
function freePorts(c) { return c.parts.filter((p) => p.def.dock && p.links.filter((u) => c.byUid.has(u)).length <= 1); }
function portTip(c, p) { const f = portFacing(c, p); return { local: [p.x, f > 0 ? p.top : p.bot], f }; }

/* Find a pair of ports that are ready to dock between craft a and b. */
function findDock(a, b) {
  for (const pa of freePorts(a)) {
    const ta = portTip(a, pa), wa = a.toWorld(...ta.local), fa = a.rotLocal(0, ta.f);
    for (const pb of freePorts(b)) {
      const tb = portTip(b, pb), wb = b.toWorld(...tb.local), fb = b.rotLocal(0, tb.f);
      const d = Math.hypot(wa[0] - wb[0], wa[1] - wb[1]);
      const align = -(fa[0] * fb[0] + fa[1] * fb[1]);
      const rel = Math.hypot(a.vel[0] - b.vel[0], a.vel[1] - b.vel[1]);
      if (d < DOCK_DIST && align > DOCK_ALIGN && rel < DOCK_SPEED) return { pa, pb, d, align, rel };
    }
  }
  return null;
}

/* Closest pair of free ports, for the docking readout and SAS: the gap, how far the target port is
   ahead of ours and to the side (in our port's frame, + = right), and the angle off face-to-face. */
function dockingInfo(a, b) {
  let best = null;
  for (const pa of freePorts(a)) {
    const ta = portTip(a, pa), wa = a.toWorld(...ta.local), fa = a.rotLocal(0, ta.f), side = a.rotLocal(ta.f, 0);
    for (const pb of freePorts(b)) {
      const tb = portTip(b, pb), wb = b.toWorld(...tb.local), fb = b.rotLocal(0, tb.f);
      const dx = wb[0] - wa[0], dy = wb[1] - wa[1], d = Math.hypot(dx, dy);
      if (!best || d < best.d) {
        best = { d, along: dx * fa[0] + dy * fa[1], lateral: dx * side[0] + dy * side[1],
          angle: Math.acos(clamp(-(fa[0] * fb[0] + fa[1] * fb[1]), -1, 1)),
          // the craft heading that puts our port face to face with theirs
          heading: Math.atan2(-fb[1], -fb[0]) + (ta.f > 0 ? 0 : Math.PI) };
      }
    }
  }
  return best;
}

/* Join craft b onto craft a at ports pa (on a) and pb (on b). b's parts are re-expressed in a's frame,
   turned half a circle so the ports meet face to face. Returns the uid offset applied to b. */
function dockCrafts(a, pa, b, pb) {
  const offset = Math.max(...a.parts.map((p) => p.uid)) + 1;
  const ta = portTip(a, pa), tb = portTip(b, pb);
  const Ma = a.M, Mb = b.M;
  const vel = [(a.vel[0] * Ma + b.vel[0] * Mb) / (Ma + Mb), (a.vel[1] * Ma + b.vel[1] * Mb) / (Ma + Mb)];
  const moved = b.parts.map((q) => {
    const mid = (q.top + q.bot) / 2;
    const x = ta.local[0] - (q.x - tb.local[0]);
    const m2 = ta.local[1] - (mid - tb.local[1]);
    return { ...q, uid: q.uid + offset, x, top: m2 + q.def.h / 2, bot: m2 - q.def.h / 2, flip: !q.flip, inv: !q.inv,
      links: q.links.map((u) => u + offset), sym: q.sym ? q.sym + offset * 1000 : null };
  });
  const pb2 = moved.find((q) => q.uid === pb.uid + offset);
  pa.links.push(pb2.uid);
  pb2.links.push(pa.uid);
  a.parts = a.parts.concat(moved);
  a.stages = a.stages.concat(b.stages.slice(b.stageIdx).map((st) => st.map((u) => u + offset)));
  a.recompute();
  a.vel = vel;
  a.angVel = 0;
  return offset;
}

/* A free, armed claw on craft a touching any part of craft b, slowly enough to latch on. */
const CLAW_REACH = 0.5, CLAW_SPEED = 1.5;
function findGrab(a, b) {
  const rel = Math.hypot(a.vel[0] - b.vel[0], a.vel[1] - b.vel[1]);
  if (rel > CLAW_SPEED) return null;
  const o = b.toWorld(0, 0), ex = b.rotLocal(1, 0), ey = b.rotLocal(0, 1);
  for (const pa of a.parts) {
    if (!pa.def.claw || pa.disarmed || pa.grabbed != null || pa.links.filter((u) => a.byUid.has(u)).length > 1) continue;
    const w = a.toWorld(...portTip(a, pa).local);
    const lx = (w[0] - o[0]) * ex[0] + (w[1] - o[1]) * ex[1], ly = (w[0] - o[0]) * ey[0] + (w[1] - o[1]) * ey[1];
    for (const pb of b.parts) {
      if (Math.abs(lx - pb.x) <= partWidth(pb) / 2 + CLAW_REACH && ly >= pb.bot - CLAW_REACH && ly <= pb.top + CLAW_REACH) return { pa, pb, rel, claw: true };
    }
  }
  return null;
}

/* Docked pairs: two linked docking ports, or a claw and what it holds. */
function dockedPairs(c) {
  const out = [];
  for (const p of c.parts) {
    if (p.def.claw && p.grabbed != null) { const q = c.byUid.get(p.grabbed); if (q) out.push([p, q]); continue; }
    if (!p.def.dock) continue;
    for (const u of p.links) { const q = c.byUid.get(u); if (q && q.def.dock && p.uid < q.uid) out.push([p, q]); }
  }
  return out;
}

/* Split craft c at a docked pair. Returns the parts that leave (not connected to the command part). */
function undockParts(c, p, q) {
  p.links = p.links.filter((u) => u !== q.uid);
  q.links = q.links.filter((u) => u !== p.uid);
  const present = new Set(c.parts.map((x) => x.uid));
  const seen = new Set([c.rootUid]), stack = [c.rootUid];
  while (stack.length) { const u = stack.pop(); for (const l of c.byUid.get(u).links) if (present.has(l) && !seen.has(l)) { seen.add(l); stack.push(l); } }
  return c.parts.filter((x) => !seen.has(x.uid));
}
