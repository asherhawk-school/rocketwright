'use strict';
/* Rocketwright — title screen, the Space Centre and its buildings. */

const SCREENS = ['title', 'hub', 'hangar', 'flight'];
function showScreen(id) { for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id); }
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/* ---------------- title ---------------- */

function showTitle() {
  if (Tut.active) endTutorial();
  F.running = false;
  hideModal();
  showScreen('title');
  const s = loadSave();
  $('btnContinue').classList.toggle('hidden', !s);
  if (s) $('titleSaveInfo').textContent = `${s.mode === 'career' ? 'Career' : 'Sandbox'} · ${fmtDate(s.ut)}${s.mode === 'career' ? ' · ' + fmtFunds(s.funds) : ''}`;
}

function startNew(mode) {
  const go = () => {
    setSave(newSave(mode, (Math.random() * 4294967296) >>> 0));
    if (mode === 'career') { refreshContracts(Career.s); persist(); }
    showHub();
    if (mode === 'career') showModal(CAREER_INTRO, [{ label: 'Let\'s go', cls: 'primary', fn: hideModal }]);
  };
  if (loadSave()) {
    showModal('<h2>Start a new game?</h2><p>This replaces your current save. You can export it first from <b>Save &amp; Settings</b>.</p>', [
      { label: 'Start new game', cls: 'primary', fn: () => { hideModal(); go(); } },
      { label: 'Cancel', fn: hideModal },
    ]);
  } else go();
}

const CAREER_INTRO = `<h2>Welcome, Director</h2>
<p>You run a brand-new space program with <b>${fmtFunds(START_FUNDS)}</b> and three astronauts.</p>
<ol>
  <li><b>Mission Control</b>: accept contracts. They pay an advance now and a reward when you complete them.</li>
  <li><b>Hangar</b>: build within budget. Only parts you've researched are available, and every launch costs the price of the rocket.</li>
  <li><b>Fly</b>: contracts complete the moment you do what they ask. Run experiments with the 🔬 Science panel (<kbd>B</kbd>).</li>
  <li><b>Recover</b> your craft on Verdan to get money back (more the closer you land to the launch site) and the full value of your science.</li>
  <li><b>Research Lab</b>: spend science to unlock new parts.</li>
</ol>
<p class="muted">Lose a crewed capsule and you lose the astronaut and some reputation. Reverting a flight undoes everything that happened in it.</p>`;

/* ---------------- hub ---------------- */

function statsHtml() {
  const s = Career.s;
  if (!s) return '';
  if (!isCareer()) return `<span class="stat">🕒 ${fmtDate(s.ut)}</span>`;
  return `<span class="stat funds" title="Funds">¤ ${fmtNum(Math.round(s.funds))}</span>
    <span class="stat sci" title="Science">⚗ ${fmtNum(s.science, 1)}</span>
    <span class="stat rep" title="Reputation">★ ${fmtNum(Math.round(s.rep))}</span>`;
}
function updateStatsBars() {
  $('hubStats').innerHTML = statsHtml();
  $('hangarFunds').innerHTML = isCareer() ? statsHtml() : '';
}

function showHub() {
  if (Tut.active) endTutorial();
  F.running = false;
  hideModal();
  showScreen('hub');
  if (Career.restoreNote) { toast(Career.restoreNote); Career.restoreNote = null; }
  asteroidTick(universe());
  persist();
  if (isCareer()) {
    const failed = refreshContracts(Career.s);
    persist();
    for (const c of failed) toast(`Contract failed: ${c.title} · −${fmtFunds(c.penalty)}`);
  }
  renderHub();
}

function renderHub() {
  const s = Career.s, career = isCareer();
  $('hubMode').textContent = career ? 'Career' : 'Sandbox';
  $('hubDate').textContent = fmtDate(s.ut);
  document.querySelectorAll('.career-only').forEach((el) => el.classList.toggle('hidden', !career));
  updateStatsBars();
  const got = loadMilestones();
  $('noteMilestones').textContent = `${Object.keys(got).length} earned`;
  const fleet = (s.vessels || []).length;
  $('noteTracking').textContent = fleet ? `${fleet} vessel${fleet > 1 ? 's' : ''} in flight` : 'Nothing in flight';
  if (!career) return;
  const act = s.contracts.filter((c) => c.state === 'active').length, off = s.contracts.filter((c) => c.state === 'offered').length;
  $('noteMission').textContent = `${act} active · ${off} offers`;
  const open = TECH_NODES.filter((n) => techState(s, n) === 'open');
  const affordable = open.filter((n) => n.cost <= s.science).length;
  $('noteResearch').textContent = affordable ? `${affordable} ready to research` : `${s.tech.length}/${TECH_NODES.length} researched`;
  const av = availableCrew(s).length;
  $('noteCrew').textContent = `${av} of ${s.crew.filter((c) => c.status !== 'lost').length} available`;
  const lv = Object.keys(FACILITIES).map((k) => facLevel(s, k));
  const can = Object.keys(FACILITIES).filter((k) => upgradeCost(s, k) != null && upgradeCost(s, k) <= s.funds).length;
  $('noteUpgrades').textContent = can ? `${can} upgrade${can > 1 ? 's' : ''} affordable` : `Levels ${lv.join(' · ')}`;
}

/* ---------------- facility upgrades ---------------- */

function showUpgrades() {
  const s = Career.s;
  const rows = Object.entries(FACILITIES).map(([id, f]) => {
    const lv = facLevel(s, id), cost = upgradeCost(s, id);
    const now = f.what(facLimit(s, id), lv), next = lv < 3 ? f.what(f.limit[lv], lv + 1) : null;
    return `<div class="fac-row"><div class="fac-ico">${f.icon}</div><div class="fac-main"><b>${f.name}</b> <span class="pill">Level ${lv}</span>
      <div class="muted">Now: ${esc(now)}</div>${next ? `<div class="fac-next">Level ${lv + 1}: ${esc(next)}</div>` : '<div class="t-done">Fully upgraded</div>'}</div>
      ${cost != null ? `<button class="primary" data-up="${id}" ${cost > s.funds ? 'disabled' : ''}>Upgrade · ${fmtFunds(cost)}</button>` : ''}</div>`;
  }).join('');
  showModal(`<h2>Space Centre Upgrades <span class="muted small">${fmtFunds(s.funds)} to spend</span></h2>
    <p class="muted">Bigger buildings let you build bigger rockets, run more contracts, plan manoeuvres and hire more astronauts.</p>${rows}`,
  [{ label: 'Close', cls: 'primary', fn: () => { hideModal(); renderHub(); } }], 'wide');
  $('modalCard').querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => {
    const err = upgradeFacility(s, b.dataset.up);
    if (err) toast(err); else { persist(); toast(`${FACILITIES[b.dataset.up].name} upgraded to level ${facLevel(s, b.dataset.up)}`); }
    showUpgrades();
  }));
}

/* ---------------- mission control ---------------- */

function contractCard(c, s) {
  const r = `<span class="pill funds">${fmtFunds(c.reward)}</span><span class="pill sci">⚗ ${c.sci}</span><span class="pill rep">★ ${c.rep}</span>`;
  let meta = '', btns = '';
  if (c.state === 'offered') {
    meta = `Advance ${fmtFunds(c.advance)} · ${c.days} days to complete · penalty ${fmtFunds(c.penalty)}`;
    btns = `<button class="primary" data-accept="${c.id}">Accept</button><button data-decline="${c.id}">Decline</button>`;
  } else if (c.state === 'active') meta = `Due in ${fmtDur(c.deadline - s.ut)} · penalty ${fmtFunds(c.penalty)} if late`;
  else meta = c.state === 'done' ? 'Completed' : 'Failed';
  return `<div class="contract ${c.state}"><div class="c-head"><b>${esc(c.title)}</b><div class="pills">${r}</div></div>
    <div class="c-desc">${esc(c.desc)}</div><div class="c-meta muted">${meta}</div>${btns ? `<div class="c-btns">${btns}</div>` : ''}</div>`;
}

function showMissionControl() {
  const s = Career.s;
  refreshContracts(s);
  persist();
  const act = s.contracts.filter((c) => c.state === 'active');
  const off = s.contracts.filter((c) => c.state === 'offered');
  const past = s.contracts.filter((c) => c.state === 'done' || c.state === 'failed').slice(-5).reverse();
  showModal(`<h2>Mission Control</h2>
    <h3>Active (${act.length}/${maxActive(s)})</h3>${act.map((c) => contractCard(c, s)).join('') || '<p class="muted">No active contracts. Accept an offer below.</p>'}
    <h3>Offers</h3>${off.map((c) => contractCard(c, s)).join('') || '<p class="muted">No offers right now. Check back later.</p>'}
    ${past.length ? `<h3>Recent</h3>${past.map((c) => contractCard(c, s)).join('')}` : ''}`,
  [{ label: 'Close', cls: 'primary', fn: () => { hideModal(); renderHub(); } }], 'wide');
  const card = $('modalCard');
  card.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', () => {
    const err = acceptContract(s, +b.dataset.accept);
    if (err) toast(err); else { persist(); toast('Contract accepted'); }
    showMissionControl();
  }));
  card.querySelectorAll('[data-decline]').forEach((b) => b.addEventListener('click', () => {
    declineContract(s, +b.dataset.decline);
    refreshContracts(s);
    persist();
    showMissionControl();
  }));
}

/* ---------------- research ---------------- */

function showResearch(selId) {
  const s = Career.s;
  if (typeof selId !== 'string' || !TECH_BY_ID[selId]) selId = null;
  const CW = 214, RH = 104, cols = Math.max(...TECH_NODES.map((n) => n.col)) + 1, rows = Math.max(...TECH_NODES.map((n) => n.row)) + 1;
  const W = cols * CW, H = rows * RH;
  if (!selId) selId = (TECH_NODES.find((n) => techState(s, n) === 'open') || TECH_NODES[0]).id;
  const lines = [];
  for (const n of TECH_NODES) for (const r of n.req) {
    const a = TECH_BY_ID[r];
    const x1 = a.col * CW + 196, y1 = a.row * RH + 44, x2 = n.col * CW, y2 = n.row * RH + 44;
    lines.push(`<path d="M${x1} ${y1} C${x1 + 14} ${y1} ${x2 - 14} ${y2} ${x2} ${y2}" class="${s.tech.includes(r) ? 'done' : ''}"/>`);
  }
  const nodes = TECH_NODES.map((n) => {
    const st = techState(s, n);
    const tag = st === 'done' ? '<span class="t-done">✓ Researched</span>' : st === 'open'
      ? `<span class="${s.science >= n.cost ? 't-can' : 't-cost'}">⚗ ${n.cost}${s.science >= n.cost ? ' · ready' : ''}</span>` : `<span class="muted">⚗ ${n.cost} · locked</span>`;
    const icons = n.parts.map((id) => `<canvas data-icon="${id}" title="${esc(PART_DEFS[id].name)}"></canvas>`).join('');
    return `<button class="tnode ${st} ${n.id === selId ? 'sel' : ''}" data-node="${n.id}" style="left:${n.col * CW}px;top:${n.row * RH}px">
      <b>${n.name}</b>${tag}<div class="t-icons">${icons}</div></button>`;
  }).join('');
  const n = TECH_BY_ID[selId], st = techState(s, n);
  const missing = n.req.filter((r) => !s.tech.includes(r)).map((r) => TECH_BY_ID[r].name);
  const action = st === 'done' ? '<span class="t-done">✓ Researched</span>'
    : st === 'open' ? `<button class="primary" data-tech="${n.id}" ${s.science < n.cost ? 'disabled' : ''}>Research for ⚗ ${n.cost}</button>
        ${s.science < n.cost ? `<span class="muted">You have ⚗ ${fmtNum(s.science, 1)}</span>` : ''}`
      : `<span class="muted">Research ${missing.join(' and ')} first</span>`;
  const parts = n.parts.map((id) => {
    const d = PART_DEFS[id];
    return `<div class="t-part"><canvas data-icon="${id}" data-big="1"></canvas><div><b>${esc(d.name)}</b> <span class="muted">· ${d.cat}</span>
      <div class="t-stat">${esc(partStatsLine(d))} · ${fmtFunds(d.cost)}</div><div class="muted">${esc(d.desc)}</div></div></div>`;
  }).join('');
  showModal(`<h2>Research Lab <span class="muted small">⚗ ${fmtNum(s.science, 1)} science to spend</span></h2>
    <div class="tech-scroll"><div class="tech-tree" style="width:${W}px;height:${H}px"><svg width="${W}" height="${H}">${lines.join('')}</svg>${nodes}</div></div>
    <div class="tech-detail"><div class="td-head"><h3>${n.name}</h3>${action}</div>
      <p class="muted">Unlocks ${n.parts.length} part${n.parts.length > 1 ? 's' : ''}:</p>${parts}</div>`,
  [{ label: 'Close', cls: 'primary', fn: () => { hideModal(); renderHub(); } }], 'wide');
  const card = $('modalCard');
  card.querySelectorAll('canvas[data-icon]').forEach((cv) => cv.dataset.big ? drawPartIcon(cv, cv.dataset.icon) : drawPartIcon(cv, cv.dataset.icon, 24, 28));
  const scroller = card.querySelector('.tech-scroll');
  if (showResearch.scroll) scroller.scrollLeft = showResearch.scroll;
  scroller.addEventListener('scroll', () => { showResearch.scroll = scroller.scrollLeft; });
  card.querySelectorAll('[data-node]').forEach((b) => b.addEventListener('click', () => showResearch(b.dataset.node)));
  card.querySelectorAll('[data-tech]').forEach((b) => b.addEventListener('click', () => {
    const err = research(s, b.dataset.tech);
    if (err) toast(err);
    else { persist(); toast(`Researched ${TECH_BY_ID[b.dataset.tech].name}`); buildPalette(); }
    showResearch(b.dataset.tech);
  }));
}

/* ---------------- astronauts ---------------- */

function showCrew() {
  const s = Career.s;
  const rows = s.crew.map((c) => `<tr class="${c.status}"><td>${esc(c.name)}</td><td title="${esc(ROLES[roleOf(c)].desc)}">${ROLES[roleOf(c)].icon} ${ROLES[roleOf(c)].name}</td><td>${'★'.repeat(crewRank(c)) || '—'}</td>
    <td>${c.flights}</td><td>${c.worlds.map((w) => BODY_BY_ID[w].name).join(', ') || '—'}</td>
    <td>${c.status === 'lost' ? 'Lost' : c.status === 'flying' ? 'Flying' : 'Available'}</td></tr>`).join('');
  const cost = hireCost(s), room = s.crew.filter((c) => c.status !== 'lost').length < facLimit(s, 'astro');
  const hire = (role) => () => {
    if (!room) { toast('The Astronaut Office is full. Upgrade it to hire more.'); return; }
    if (s.funds < cost) { toast('Not enough funds'); return; }
    const c = hireCrew(s, false, role);
    persist();
    toast(`${c.name} joined the program as a ${ROLES[role].name.toLowerCase()}`);
    showCrew();
  };
  showModal(`<h2>Astronaut Office</h2>
    <p class="muted">Each capsule needs an astronaut. Experience grows with flights and new worlds visited.</p>
    <table class="crew-table"><tr><th>Name</th><th>Role</th><th>Rank</th><th>Flights</th><th>Worlds</th><th>Status</th></tr>${rows}</table>
    <div class="role-help">${ROLE_ORDER.map((r) => `<div><b>${ROLES[r].icon} ${ROLES[r].name}</b> <span class="muted">${esc(ROLES[r].desc)}</span></div>`).join('')}</div>
    <p class="muted">${room ? `Hiring costs ${fmtFunds(cost)}.` : `The office holds ${facLimit(s, 'astro')} astronauts. Upgrade it at the Space Centre to hire more.`}</p>`,
  [...ROLE_ORDER.map((r) => ({ label: `Hire ${ROLES[r].name.toLowerCase()}`, fn: hire(r) })),
    { label: 'Close', cls: 'primary', fn: () => { hideModal(); renderHub(); } }]);
}

/* ---------------- tracking station ---------------- */

function trackingLost(lost) {
  for (const v of lost) {
    toast(`${v.name} was lost${v.lostAt ? ' at ' + BODY_BY_ID[v.lostAt].name : ''}`);
    if (isCareer()) crewLost(v.crew);
  }
}

function showTracking() {
  const s = universe();
  asteroidTick(s);
  trackingLost(advanceAll(s.ut));
  persist();
  const rows = s.vessels.map((v) => {
    const b = vesselBody(v);
    const home = v.landed && b === HOME;
    const crew = crewNames(v.crew);
    return `<div class="trk-row ${v.kind}">
      <div><b>${esc(v.name)}</b>${v.kind === 'stranded' ? ' <span class="pill rep">needs rescue</span>' : v.kind === 'eva' ? ' <span class="pill">on a spacewalk</span>' : v.kind === 'flag' ? ' <span class="pill">flag</span>' : v.kind === 'asteroid' ? ` <span class="pill">asteroid${v.rockClass ? ` · class ${v.rockClass}` : ''}${v.expires ? ` · leaves in ${fmtDur(v.expires - s.ut)}` : ''}</span>` : ''}
        <div class="muted">${esc(vesselSituation(v))} · ${fmtDur(s.ut - v.launchT)} since launch${crew.length ? ' · 👩‍🚀 ' + esc(crew.join(', ')) : ''}</div></div>
      <div class="trk-btns">${v.kind === 'stranded' || v.kind === 'flag' || v.kind === 'asteroid' ? '' : `<button class="primary" data-fly="${v.id}">Fly</button>`}
        ${home ? `<button data-rec="${v.id}">Recover</button>` : ''}
        ${v.flags && v.flags.log && v.flags.log.length ? `<button data-log="${v.id}">Log</button>` : ''}
        ${v.kind === 'stranded' ? '' : `<button data-del="${v.id}">Terminate</button>`}</div></div>`;
  }).join('');
  showModal(`<h2>Tracking Station <span class="muted small">${fmtDate(s.ut)}</span></h2>
    <canvas id="trkMap" class="trk-map"></canvas>
    <div class="trk-time"><span class="muted">Wait at the Space Centre:</span>
      <button data-wait="3600">1 hour</button><button data-wait="21600">6 hours</button><button data-wait="86400">1 day</button><button data-wait="864000">10 days</button></div>
    ${rows || '<p class="muted">Nothing in flight. Vessels you leave in space (Menu → Space Centre) show up here.</p>'}`,
  [{ label: 'Close', cls: 'primary', fn: () => { hideModal(); renderHub(); } }], 'wide');
  drawTrackingMap(s);
  const card = $('modalCard');
  const find = (id) => s.vessels.find((v) => v.id === +id);
  card.querySelectorAll('[data-fly]').forEach((b) => b.addEventListener('click', () => {
    const v = find(b.dataset.fly);
    if (!v) return;
    hideModal();
    showScreen('flight');
    resizeFlight();
    flightLoadVessel(v, s.ut);
    fillTargetSelect();
  }));
  card.querySelectorAll('[data-log]').forEach((b) => b.addEventListener('click', () => {
    const v = s.vessels.find((x) => x.id === +b.dataset.log);
    if (!v) return;
    showModal(`<h2>${esc(v.name)} · flight log</h2><ul class="plain flog-list">${logHtml(v.flags.log, v.launchT)}</ul>`,
      [{ label: 'Back', cls: 'primary', fn: showTracking }]);
  }));
  card.querySelectorAll('[data-rec]').forEach((b) => b.addEventListener('click', () => {
    const v = find(b.dataset.rec);
    if (!v) return;
    const r = recoverRecord(v);
    persist();
    toast(`${v.name} recovered${isCareer() ? ` · +${fmtFunds(r.refund)}` : ''}${r.sci ? ` · +${r.sci.toFixed(1)} ⚗` : ''}`);
    for (const c of r.done) toast(`Contract complete: ${c.title}`);
    showTracking();
  }));
  card.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const v = find(b.dataset.del);
    if (!v) return;
    const crew = crewNames(v.crew);
    showModal(`<h2>Terminate ${esc(v.name)}?</h2><p>It will be removed for good.${crew.length ? ` <b>${esc(crew.join(', '))}</b> will be lost.` : ''}</p>`, [
      { label: 'Terminate', cls: 'primary', fn: () => { if (isCareer()) crewLost(v.crew); s.vessels = s.vessels.filter((x) => x !== v); persist(); showTracking(); } },
      { label: 'Cancel', fn: showTracking },
    ]);
  }));
  card.querySelectorAll('[data-wait]').forEach((b) => b.addEventListener('click', () => {
    s.ut += +b.dataset.wait;
    trackingLost(advanceAll(s.ut));
    if (isCareer()) for (const c of refreshContracts(s)) toast(`Contract failed: ${c.title}`);
    persist();
    showTracking();
  }));
}

/* A small map of where everything is: Verdan's neighbourhood, or the whole system if needed. */
function drawTrackingMap(s) {
  const cv = $('trkMap');
  const W = cv.clientWidth || 600, H = 260, dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, W, H);
  const local = s.vessels.every((v) => inHomeSystem(vesselBody(v)));
  const t = s.ut, z = local ? Math.min(W, H) / (MOON.orbitR * 2.4) : Math.min(W, H) / (UMBRA.orbitR * 2.3);
  const foc = local ? [0, 0] : bodyPos(SUN, t);
  const S = (x, y) => [W / 2 + (x - foc[0]) * z, H / 2 - (y - foc[1]) * z];
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
  for (const b of BODIES) {
    if (b.parent) {
      const pp = bodyPos(b.parent, t), [px, py] = S(pp[0], pp[1]);
      if (b.orbitR * z > 4) { ctx.strokeStyle = 'rgba(180,190,210,0.15)'; ctx.beginPath(); ctx.arc(px, py, b.orbitR * z, 0, TAU); ctx.stroke(); }
    }
    const bp = bodyPos(b, t), [x, y] = S(bp[0], bp[1]);
    if (!b.star && b.parent && !b.parent.star && b.orbitR * z < 10) continue;
    ctx.fillStyle = b.colMap; ctx.beginPath(); ctx.arc(x, y, Math.max(b.R * z, b.star ? 5 : 3), 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText(b.name, x, y - Math.max(b.R * z, 4) - 5);
  }
  for (const v of s.vessels) {
    const [x, y] = S(v.s[0], v.s[1]);
    ctx.fillStyle = v.kind === 'stranded' ? '#ffb347' : '#e070ff';
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill();
    ctx.fillText(v.name, x, y + 15);
  }
}

/* ---------------- tutorials ---------------- */

function showTutorials() {
  const items = TUTORIALS.map((t) => `<div class="trk-row"><div><b>${t.name}</b><div class="muted">${t.desc}</div></div>
    <div class="trk-btns"><button class="primary" data-tut="${t.id}">Start</button></div></div>`).join('');
  showModal(`<h2>Tutorials</h2><p class="muted">Guided flights. They don't change your save.</p>${items}`,
    [{ label: 'Close', cls: 'primary', fn: hideModal }]);
  $('modalCard').querySelectorAll('[data-tut]').forEach((b) => b.addEventListener('click', () => startTutorial(b.dataset.tut)));
}

/* ---------------- Δv map ---------------- */

function showDvMap(back) {
  const n = (x) => (x == null ? '—' : fmtNum(Math.round(x / 10) * 10));
  const rows = dvMapRows().map((r) => {
    const moon = r.b.parent !== SUN;
    const total = r.transfer + r.capture + (r.land || 0);
    return `<tr><td class="${moon ? 'moon' : ''}"><span class="dot" style="background:${r.b.colMap}"></span>${r.b.name}</td>
      <td>${n(r.transfer)}</td><td>${n(r.capture)}${r.aero ? '*' : ''}</td><td>${r.b.gas ? 'no surface' : n(r.land)}</td>
      <td>${r.b.gas ? n(r.transfer + r.capture) : n(total)}</td><td>${fmtDur(r.time)}</td></tr>`;
  }).join('');
  showModal(`<h2>Δv map</h2>
    <p class="muted">Rough Δv in m/s for a one-way trip, starting from a low orbit around Verdan. Reaching that orbit from the launch pad
    takes about <b>${n(launchDv(HOME))}</b>. Add a margin of 10–20%: real burns are never perfect.</p>
    <table class="dvtable"><tr><th>World</th><th>Transfer</th><th>Capture</th><th>Land / launch</th><th>Total</th><th>Trip</th></tr>${rows}</table>
    <p class="muted small-note">* Worlds with air can use it to slow down (aerobraking or parachutes) instead of burning, if you have a heat shield.
    Coming home, Verdan's air does the braking for you.</p>`,
  [{ label: 'Close', cls: 'primary', fn: () => { hideModal(); if (back) back(); } }], 'wide');
}

/* ---------------- save & settings ---------------- */

function showSettings() {
  showModal(`<h2>Save &amp; Settings</h2>
    <label class="field">Sound volume <input type="range" id="volSlider" min="0" max="1" step="0.05" value="${Sound.vol}"></label>
    <label class="field">Graphics <select id="gfxSelect" ${R3.ok ? '' : 'disabled'}>
      <option value="3d" ${gfx3d() ? 'selected' : ''}>3D (round parts, lighting, a camera you can turn)</option>
      <option value="2d" ${gfx3d() ? '' : 'selected'}>Classic 2D${R3.ok ? '' : ' (3D needs WebGL)'}</option></select></label>
    ${Career.s ? `<h3>This game</h3>
    <label class="check"><input type="checkbox" id="optComm" ${Career.s.commnet ? 'checked' : ''}> Comms network: probes need a signal from a ground station or relay to be controlled, and science needs one to be transmitted</label>
    <label class="check"><input type="checkbox" id="optRevert" ${diff('revert') ? 'checked' : ''}> Allow reverting flights and quick saves</label>
    <div class="diff-grid">
      ${[['heat', 'Reentry heating', [[0.5, 'Gentle'], [1, 'Normal'], [1.5, 'Fierce']]], ['crash', 'Crash tolerance', [[0.7, 'Fragile'], [1, 'Normal'], [1.5, 'Sturdy']]],
        ['funds', 'Money rewards', [[0.5, 'Half'], [1, 'Normal'], [1.5, 'Generous']]], ['science', 'Science rewards', [[0.5, 'Half'], [1, 'Normal'], [1.5, 'Generous']]]]
        .map(([k, label, opts]) => `<label class="field">${label}<select data-diff="${k}">${opts.map(([v, n]) => `<option value="${v}" ${diff(k) === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`).join('')}
    </div>` : ''}
    <p>Your game saves automatically in this browser. Export it to keep a copy or move it to another device.</p>
    <input type="file" id="importFile" accept=".json,application/json" class="hidden">`, [
    { label: 'Export save', cls: 'primary', fn: exportSave },
    { label: 'Import save', fn: () => $('importFile').click() },
    { label: 'Main menu', fn: showTitle },
    { label: 'Close', fn: hideModal },
  ]);
  $('importFile').addEventListener('change', (e) => importSave(e.target.files[0]));
  $('volSlider').addEventListener('input', (e) => { initSound(); setVolume(+e.target.value); });
  $('volSlider').addEventListener('change', () => playSound('stage'));
  $('gfxSelect').addEventListener('change', (e) => { setGfx(e.target.value); buildPalette(); });
  if ($('optComm')) $('optComm').addEventListener('change', (e) => { Career.s.commnet = e.target.checked; persist(); });
  if ($('optRevert')) $('optRevert').addEventListener('change', (e) => { Career.s.diff.revert = e.target.checked; persist(); });
  $('modalCard').querySelectorAll('[data-diff]').forEach((sel) => sel.addEventListener('change', () => { Career.s.diff[sel.dataset.diff] = +sel.value; persist(); }));
}

function exportSave() {
  const blob = new Blob([JSON.stringify({ rocketwright: SAVE_VERSION, save: Career.s, crafts: Store.get('saved', {}) }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rocketwright-${Career.s.mode}-day${Math.floor(Career.s.ut / DAY) + 1}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function importSave(file) {
  if (!file) return;
  file.text().then((txt) => {
    let data;
    try { data = JSON.parse(txt); } catch (e) { toast('That file is not a Rocketwright save'); return; }
    const s = data && data.save;
    if (!s || s.v !== SAVE_VERSION || !Array.isArray(s.tech)) { toast('That file is not a Rocketwright save'); return; }
    setSave(s);
    if (data.crafts) Store.set('saved', { ...Store.get('saved', {}), ...data.crafts });
    fillLoadSelect();
    toast('Save imported');
    showHub();
  });
}

function wireHub() {
  $('btnContinue').addEventListener('click', () => { if (loadSave()) showHub(); });
  $('btnNewCareer').addEventListener('click', () => startNew('career'));
  $('btnNewSandbox').addEventListener('click', () => startNew('sandbox'));
  $('bldHangar').addEventListener('click', showHangar);
  $('bldMission').addEventListener('click', showMissionControl);
  $('bldResearch').addEventListener('click', () => showResearch());
  $('bldCrew').addEventListener('click', showCrew);
  $('bldMilestones').addEventListener('click', showMilestones);
  $('bldTracking').addEventListener('click', showTracking);
  $('bldUpgrades').addEventListener('click', showUpgrades);
  $('bldTutorials').addEventListener('click', showTutorials);
  $('bldSettings').addEventListener('click', showSettings);
  $('btnHubHelp').addEventListener('click', showHelp);
  $('btnDvMap').addEventListener('click', () => showDvMap());
  $('btnTitle').addEventListener('click', showTitle);
  $('btnBackHub').addEventListener('click', showHub);
  onCareerChange(updateStatsBars);
}
