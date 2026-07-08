// Read-only shared contest dashboard — mirrors the admin Dashboard tab.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const token = location.pathname.split('/').filter(Boolean).pop();
const heatColor = (p) => `hsl(${Math.round((p / 100) * 120)},70%,${p === 0 ? 30 : 52}%)`;
function questionUrl(q) { const u = q.url; if (!u || u === '#') return null; return u.startsWith('http') ? u : 'https://www.hackerrank.com' + (u.startsWith('/') ? u : '/' + u); }
function splitTitle(name) { const m = String(name).split(/\s+[–—-]\s+/); return m.length >= 2 ? { tag: m[0].trim(), title: m.slice(1).join(' - ').trim() } : { tag: '', title: String(name) }; }

let dashData = null, dashTopics = {}, dashCats = {}, roster = [], dailyData = null;
let studentsPage = 1; const STUDENTS_PAGE = 50;
let taRows = [];
let compDist = [], compTotal = 0, compTotalQ = 0, compMax = 1, compPage = 1; const COMP_PAGE = 20;
let cbRows = [], cbPage = 1; const CB_PAGE = 20;

async function boot() {
  try {
    const res = await fetch('/api/shared/' + token);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Not found');
    dashData = d.dashboard; dashTopics = d.topics || {}; dashCats = d.categories || {}; roster = d.roster || []; dailyData = d.daily || null;
    $('view-title').textContent = `${d.contest.name} — ${d.college}`;
    document.title = `${d.contest.name} · ${d.college}`;
    if (!dashData) { $('view-status').textContent = 'This contest has not been synced yet.'; $('view-status').className = 'status info'; return; }
    fillFilters(); renderSummary(); renderTopicAnalysis(); renderCompletion(); renderCategoryChart(); renderStudents(); renderDaily();
  } catch (e) { $('view-status').textContent = e.message; $('view-status').className = 'status err'; }
}

function joinedRows() {
  const byUser = new Map((dashData?.users || []).map((u) => [u.username.toLowerCase(), u]));
  return roster.map((s) => { const u = byUser.get(s.hrUsername.toLowerCase()); const totalQ = dashData?.summary.totalQuestions || 0;
    return { ...s, inContest: !!u, solved: u ? u.solved : 0, score: u ? u.computedScore : 0, totalQ, completion: u && totalQ ? Math.round((u.solved / totalQ) * 100) : 0 }; });
}
function fillFilters() {
  for (const [id, key] of [['f-department', 'department'], ['f-section', 'section'], ['f-year', 'year']]) {
    const sel = $(id); const vals = Array.from(new Set(roster.map((s) => s[key]).filter(Boolean))).sort();
    sel.innerHTML = `<option value="">All ${key === 'department' ? 'departments' : key + 's'}</option>` + vals.map((v) => `<option>${esc(v)}</option>`).join('');
    sel.addEventListener('change', () => { studentsPage = 1; renderStudents(); });
  }
  $('f-search').addEventListener('input', () => { studentsPage = 1; renderStudents(); });
}
function filteredRows() {
  const f = { department: $('f-department').value, section: $('f-section').value, year: $('f-year').value, q: $('f-search').value.trim().toLowerCase() };
  return joinedRows().filter((r) => (!f.department || r.department === f.department) && (!f.section || r.section === f.section) && (!f.year || r.year === f.year) &&
    (!f.q || (r.name || '').toLowerCase().includes(f.q) || (r.hrUsername || '').toLowerCase().includes(f.q))).sort((a, b) => b.solved - a.solved || b.score - a.score);
}
function renderSummary() {
  const sm = $('summary'); sm.classList.remove('hidden');
  const inContest = roster.filter((s) => dashData.users.some((u) => u.username.toLowerCase() === s.hrUsername.toLowerCase())).length;
  sm.innerHTML = [['Students', roster.length], ['In contest', inContest], ['Questions', dashData.summary.totalQuestions], ['Avg solved', dashData.summary.avgSolved], ['Completion', dashData.summary.overallCompletion + '%']]
    .map(([l, v]) => `<div class="stat"><div class="value">${v}</div><div class="label">${l}</div></div>`).join('');
}

// ---- Topic analysis ----
function topicChartSVG(rows) {
  const rowH = 28, top = 8, left = 168, barMax = 320, W = 620, H = top * 2 + rows.length * rowH;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-height:${H}px;font-family:inherit">`;
  rows.forEach((r, i) => {
    const y = top + i * rowH; const bw = Math.max(2, Math.round((barMax * r.solveRate) / 100));
    const name = esc(r.topic.length > 24 ? r.topic.slice(0, 23) + '…' : r.topic);
    s += `<text x="${left - 8}" y="${y + 15}" text-anchor="end" fill="var(--text)" font-size="12">${name}</text>`;
    s += `<rect x="${left}" y="${y + 4}" width="${barMax}" height="16" rx="4" fill="var(--surface2)"/>`;
    s += `<rect x="${left}" y="${y + 4}" width="${bw}" height="16" rx="4" fill="${heatColor(r.solveRate)}"><title>${name}: ${r.solveRate}%</title></rect>`;
    s += `<text x="${left + barMax + 8}" y="${y + 15}" fill="var(--muted)" font-size="12">${r.solveRate}%</text>`;
  });
  return s + `</svg>`;
}
function renderTopicAnalysis() {
  const card = $('topic-analysis-card');
  const byUser = new Map(dashData.users.map((u) => [u.username.toLowerCase(), u]));
  const participants = roster.map((s) => byUser.get(s.hrUsername.toLowerCase())).filter(Boolean);
  if (!participants.length) { card.classList.add('hidden'); return; }
  const topicQs = new Map();
  for (const q of dashData.questions) { const t = dashTopics[q.name] || splitTitle(q.name).tag || 'Other'; if (!topicQs.has(t)) topicQs.set(t, []); topicQs.get(t).push(q.name); }
  const rows = Array.from(topicQs.entries()).map(([topic, qs]) => {
    let solved = 0; for (const u of participants) for (const qn of qs) if (u.questionStatus[qn]?.solved) solved++;
    const denom = participants.length * qs.length;
    return { topic, questions: qs.length, solveRate: denom ? Math.round((solved / denom) * 100) : 0, avgSolved: +(solved / participants.length).toFixed(2) };
  }).sort((a, b) => b.solveRate - a.solveRate);
  taRows = rows;
  const weakest = rows[rows.length - 1];
  $('ta-note').textContent = `· ${participants.length} participants · ${rows.length} topics · weakest: ${weakest.topic} (${weakest.solveRate}%)`;
  $('ta-chart').innerHTML = topicChartSVG(rows);
  $('topic-analysis-table').innerHTML =
    `<thead><tr><th>#</th><th>Topic</th><th class="num">Questions</th><th class="num">Avg solved / student</th><th>Solve rate</th></tr></thead><tbody>` +
    rows.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.topic)}</td><td class="num">${r.questions}</td><td class="num">${r.avgSolved}</td><td><div class="bar" style="display:inline-block;width:120px;vertical-align:middle"><span style="width:${r.solveRate}%"></span></div> <span class="muted">${r.solveRate}%</span></td></tr>`).join('') +
    `</tbody>`;
  card.classList.remove('hidden');
}
$('ta-chart-btn').addEventListener('click', () => { if (!taRows.length) return; $('ta-modal-chart').innerHTML = topicChartSVG(taRows); $('ta-modal').classList.remove('hidden'); });
$('ta-modal-close').addEventListener('click', () => $('ta-modal').classList.add('hidden'));
$('ta-modal').addEventListener('click', (e) => { if (e.target.id === 'ta-modal') $('ta-modal').classList.add('hidden'); });

// ---- Question categories ----
const CAT_LABELS = { inclass: 'In-class', postclass: 'Post-class', challenges: 'Challenges' };
function renderCategoryChart() {
  const card = $('category-card');
  if (!dashData) { card.classList.add('hidden'); return; }
  const byUser = new Map(dashData.users.map((u) => [u.username.toLowerCase(), u]));
  const participants = roster.map((s) => byUser.get(s.hrUsername.toLowerCase())).filter(Boolean);
  const catQs = new Map();
  for (const q of dashData.questions) { const c = dashCats[q.name]; if (!c) continue; if (!catQs.has(c)) catQs.set(c, []); catQs.get(c).push(q.name); }
  if (!participants.length || !catQs.size) { card.classList.add('hidden'); return; }
  const rows = ['inclass', 'postclass', 'challenges'].filter((c) => catQs.has(c)).map((c) => {
    const qs = catQs.get(c); let solved = 0;
    for (const u of participants) for (const qn of qs) if (u.questionStatus[qn]?.solved) solved++;
    const denom = participants.length * qs.length;
    return { topic: CAT_LABELS[c] || c, questions: qs.length, solveRate: denom ? Math.round((solved / denom) * 100) : 0 };
  });
  $('cat-note').textContent = `· ${participants.length} participants`;
  $('cat-chart').innerHTML = topicChartSVG(rows);
  $('cat-table').innerHTML =
    `<thead><tr><th>Category</th><th class="num">Questions</th><th class="num">Solve rate</th></tr></thead><tbody>` +
    rows.map((r) => `<tr><td>${esc(r.topic)}</td><td class="num">${r.questions}</td><td class="num">${r.solveRate}%</td></tr>`).join('') + `</tbody>`;

  const present = ['inclass', 'postclass', 'challenges'].filter((c) => catQs.has(c));
  const topicOrder = []; const tset = new Set(); const cellMap = {};
  for (const q of dashData.questions) {
    const cat = dashCats[q.name]; if (!cat || !present.includes(cat)) continue;
    const topic = dashTopics[q.name] || splitTitle(q.name).tag || 'Other';
    if (!tset.has(topic)) { tset.add(topic); topicOrder.push(topic); }
    cellMap[topic] = cellMap[topic] || {};
    cellMap[topic][cat] = cellMap[topic][cat] || { total: 0, solved: 0, qs: [] };
    const e = cellMap[topic][cat]; e.total++; e.qs.push(q.name);
    for (const u of participants) if (u.questionStatus[q.name]?.solved) e.solved++;
  }
  tcCellMap = cellMap;
  $('cat-topic-table').innerHTML =
    `<thead><tr><th>Topic</th>${present.map((c) => `<th class="num">${CAT_LABELS[c]}</th>`).join('')}</tr></thead><tbody>` +
    topicOrder.map((t) => `<tr><td>${esc(t)}</td>${present.map((c) => {
      const e = cellMap[t] && cellMap[t][c];
      if (!e) return '<td class="num muted">—</td>';
      const pct = e.total ? Math.round((e.solved / (participants.length * e.total)) * 100) : 0;
      return `<td class="tcell" data-topic="${esc(t)}" data-cat="${c}" style="background:${heatColor(pct)};cursor:pointer">${pct}% <span style="opacity:.7">(${e.total})</span></td>`;
    }).join('')}</tr>`).join('') + `</tbody>`;
  card.classList.remove('hidden');
}
let tcCellMap = {}, tcRows = [], tcFilter = 'all', tcPage = 1;
const TC_PAGE = 20;
$('cat-topic-table').addEventListener('click', (e) => { const td = e.target.closest('td.tcell[data-topic]'); if (td) openTopicCat(td.dataset.topic, td.dataset.cat); });
function openTopicCat(topic, cat) {
  const entry = tcCellMap[topic] && tcCellMap[topic][cat]; if (!entry) return;
  const qs = entry.qs; const byUser = new Map(dashData.users.map((u) => [u.username.toLowerCase(), u]));
  const rows = [];
  for (const s of roster) { const u = byUser.get(s.hrUsername.toLowerCase()); if (!u) continue; const solved = qs.filter((qn) => u.questionStatus[qn]?.solved).length; rows.push({ name: s.name || s.hrUsername, hrUsername: s.hrUsername, department: s.department, section: s.section, solved, total: qs.length, completed: solved === qs.length }); }
  const done = rows.filter((r) => r.completed).length;
  tcRows = rows.sort((a, b) => (b.completed - a.completed) || (b.solved - a.solved)); tcFilter = 'all'; tcPage = 1;
  $('tc-modal-title').textContent = `${topic} · ${CAT_LABELS[cat] || cat} — ${done}/${rows.length} completed (${qs.length} question${qs.length > 1 ? 's' : ''})`;
  renderTcPage(); $('tc-modal').classList.remove('hidden');
}
function tcFiltered() { return tcFilter === 'done' ? tcRows.filter((r) => r.completed) : tcFilter === 'not' ? tcRows.filter((r) => !r.completed) : tcRows; }
function renderTcPage() {
  const all = tcFiltered(); const pages = Math.max(1, Math.ceil(all.length / TC_PAGE));
  if (tcPage > pages) tcPage = pages;
  const start = (tcPage - 1) * TC_PAGE; const slice = all.slice(start, start + TC_PAGE);
  document.querySelectorAll('#tc-filter-all,#tc-filter-done,#tc-filter-not').forEach((b) => b.classList.remove('active-filter'));
  $('tc-filter-' + (tcFilter === 'done' ? 'done' : tcFilter === 'not' ? 'not' : 'all')).classList.add('active-filter');
  $('tc-modal-table').innerHTML =
    `<thead><tr><th>#</th><th>Student</th><th>HR username</th><th>Dept</th><th>Section</th><th class="num">Solved</th><th>Status</th></tr></thead><tbody>` +
    (slice.length ? slice.map((r, i) => `<tr><td class="num">${start + i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.hrUsername)}</td><td>${esc(r.department || '—')}</td><td>${esc(r.section || '—')}</td><td class="num">${r.solved}/${r.total}</td><td><span class="badge ${r.completed ? 'solved' : 'attempted'}">${r.completed ? 'Completed' : 'Not completed'}</span></td></tr>`).join('')
      : `<tr><td colspan="7" class="muted">None.</td></tr>`) + `</tbody>`;
  const from = all.length ? start + 1 : 0;
  $('tc-pager').innerHTML = all.length > TC_PAGE ? `<button class="ghost sm" id="tc-prev" ${tcPage <= 1 ? 'disabled' : ''}>‹ Prev</button><span class="muted">${from}–${Math.min(start + TC_PAGE, all.length)} of ${all.length} · page ${tcPage}/${pages}</span><button class="ghost sm" id="tc-next" ${tcPage >= pages ? 'disabled' : ''}>Next ›</button>` : '';
  if (all.length > TC_PAGE) { $('tc-prev').addEventListener('click', () => { if (tcPage > 1) { tcPage--; renderTcPage(); } }); $('tc-next').addEventListener('click', () => { if (tcPage < pages) { tcPage++; renderTcPage(); } }); }
}
$('tc-filter-all').addEventListener('click', () => { tcFilter = 'all'; tcPage = 1; renderTcPage(); });
$('tc-filter-done').addEventListener('click', () => { tcFilter = 'done'; tcPage = 1; renderTcPage(); });
$('tc-filter-not').addEventListener('click', () => { tcFilter = 'not'; tcPage = 1; renderTcPage(); });
$('tc-modal-close').addEventListener('click', () => $('tc-modal').classList.add('hidden'));
$('tc-modal').addEventListener('click', (e) => { if (e.target.id === 'tc-modal') $('tc-modal').classList.add('hidden'); });

// ---- Completion breakdown ----
function renderCompletion() {
  const card = $('completion-card'); const rows = joinedRows();
  if (!rows.length) { card.classList.add('hidden'); return; }
  const totalQ = dashData.summary.totalQuestions;
  const dist = Array.from({ length: totalQ + 1 }, () => 0);
  for (const r of rows) dist[r.solved] = (dist[r.solved] || 0) + 1;
  const total = rows.length, maxCount = Math.max(...dist, 1);
  $('cb-note').textContent = `· ${total} students`;
  $('completion-table').innerHTML =
    `<thead><tr><th>Questions solved</th><th class="num">Students</th><th class="num">%</th><th>Distribution</th></tr></thead><tbody>` +
    dist.map((count, k) => `<tr class="cb-row" data-solved="${k}" style="cursor:pointer"><td>${k} / ${totalQ}${k === totalQ ? ' (all)' : k === 0 ? ' (none)' : ''}</td><td class="num">${count}</td><td class="num">${total ? Math.round((count / total) * 100) : 0}%</td><td><div class="bar" style="display:inline-block;width:160px;vertical-align:middle"><span style="width:${Math.round((count / maxCount) * 100)}%"></span></div></td></tr>`).join('') +
    `</tbody>`;
  $('completion-pager').innerHTML = '';
  card.classList.remove('hidden');
}
$('completion-table').addEventListener('click', (e) => { const row = e.target.closest('.cb-row[data-solved]'); if (row) openCompletionNames(Number(row.dataset.solved)); });
function openCompletionNames(k) {
  const totalQ = dashData.summary.totalQuestions;
  cbRows = joinedRows().filter((r) => r.solved === k).sort((a, b) => b.score - a.score); cbPage = 1;
  $('cb-modal-title').textContent = `${cbRows.length} student(s) solved ${k} / ${totalQ}`;
  renderCbPage(); $('cb-modal').classList.remove('hidden');
}
function renderCbPage() {
  const total = cbRows.length; const pages = Math.max(1, Math.ceil(total / CB_PAGE));
  if (cbPage > pages) cbPage = pages;
  const start = (cbPage - 1) * CB_PAGE, slice = cbRows.slice(start, start + CB_PAGE);
  $('cb-modal-table').innerHTML = `<thead><tr><th>#</th><th>Student</th><th>HR username</th><th>Dept</th><th>Section</th><th class="num">Score</th></tr></thead><tbody>` +
    (slice.length ? slice.map((r, idx) => `<tr><td class="num">${start + idx + 1}</td><td><a class="user-link" data-user="${esc(r.hrUsername)}">${esc(r.name || r.hrUsername)}</a></td><td>${esc(r.hrUsername)}</td><td>${esc(r.department || '—')}</td><td>${esc(r.section || '—')}</td><td class="num">${r.score}</td></tr>`).join('') : `<tr><td colspan="6" class="muted">No students.</td></tr>`) + `</tbody>`;
  const from = total ? start + 1 : 0;
  $('cb-pager').innerHTML = total > CB_PAGE ? `<button class="ghost sm" id="cb-prev" ${cbPage <= 1 ? 'disabled' : ''}>‹ Prev</button><span class="muted">${from}–${Math.min(start + CB_PAGE, total)} of ${total} · page ${cbPage}/${pages}</span><button class="ghost sm" id="cb-next" ${cbPage >= pages ? 'disabled' : ''}>Next ›</button>` : '';
  if (total > CB_PAGE) { $('cb-prev').addEventListener('click', () => { if (cbPage > 1) { cbPage--; renderCbPage(); } }); $('cb-next').addEventListener('click', () => { if (cbPage < pages) { cbPage++; renderCbPage(); } }); }
}
$('cb-modal-close').addEventListener('click', () => $('cb-modal').classList.add('hidden'));
$('cb-modal').addEventListener('click', (e) => { if (e.target.id === 'cb-modal') $('cb-modal').classList.add('hidden'); });
$('cb-modal-table').addEventListener('click', (e) => { const l = e.target.closest('.user-link[data-user]'); if (l) { e.preventDefault(); $('cb-modal').classList.add('hidden'); openPerf(l.dataset.user); } });

// ---- Students table ----
function renderStudents() {
  const all = filteredRows(); const pages = Math.max(1, Math.ceil(all.length / STUDENTS_PAGE));
  if (studentsPage > pages) studentsPage = pages;
  const start = (studentsPage - 1) * STUDENTS_PAGE, rows = all.slice(start, start + STUDENTS_PAGE);
  $('students-table').innerHTML =
    `<thead><tr><th>#</th><th>Student</th><th>HR username</th><th>Dept</th><th>Section</th><th class="num">Solved</th><th class="num">Score</th><th>Completion</th></tr></thead><tbody>` +
    (rows.length ? rows.map((r, idx) => `<tr><td class="num">${start + idx + 1}</td><td><a class="user-link" data-user="${esc(r.hrUsername)}">${esc(r.name || r.hrUsername)}</a></td><td>${esc(r.hrUsername)}${r.inContest ? '' : ' <span class="muted">·absent</span>'}</td><td>${esc(r.department || '—')}</td><td>${esc(r.section || '—')}</td><td class="num">${r.solved}/${r.totalQ}</td><td class="num">${r.score}</td><td><div class="bar"><span style="width:${r.completion}%"></span></div></td></tr>`).join('') : `<tr><td colspan="8" class="muted">No students.</td></tr>`) + `</tbody>`;
  const from = all.length ? start + 1 : 0;
  $('students-pager').innerHTML = all.length > STUDENTS_PAGE ? `<button class="ghost sm" id="st-prev" ${studentsPage <= 1 ? 'disabled' : ''}>‹ Prev</button><span class="muted">${from}–${Math.min(start + STUDENTS_PAGE, all.length)} of ${all.length} · page ${studentsPage}/${pages}</span><button class="ghost sm" id="st-next" ${studentsPage >= pages ? 'disabled' : ''}>Next ›</button>` : '';
  if (all.length > STUDENTS_PAGE) { $('st-prev').addEventListener('click', () => { if (studentsPage > 1) { studentsPage--; renderStudents(); } }); $('st-next').addEventListener('click', () => { if (studentsPage < pages) { studentsPage++; renderStudents(); } }); }
}
$('students-table').addEventListener('click', (e) => { const l = e.target.closest('.user-link[data-user]'); if (l) { e.preventDefault(); openPerf(l.dataset.user); } });

// ---- Performance modal ----
$('perf-close').addEventListener('click', () => $('perf-modal').classList.add('hidden'));
$('perf-modal').addEventListener('click', (e) => { if (e.target.id === 'perf-modal') $('perf-modal').classList.add('hidden'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.modal-overlay').forEach((m) => m.classList.add('hidden')); });
function openPerf(hrUsername) {
  const r = joinedRows().find((x) => x.hrUsername.toLowerCase() === hrUsername.toLowerCase()); if (!r) return;
  const u = dashData?.users.find((x) => x.username.toLowerCase() === hrUsername.toLowerCase());
  $('perf-title').textContent = r.name || hrUsername;
  $('perf-meta').innerHTML = [`@${esc(hrUsername)}`, r.registerNo && `Reg: ${esc(r.registerNo)}`, r.department && esc(r.department), r.section && `Sec ${esc(r.section)}`, r.year && `Year ${esc(r.year)}`].filter(Boolean).join(' · ');
  if (!u) { $('perf-stats').innerHTML = `<div class="stat"><div class="value">—</div><div class="label">No contest data</div></div>`; $('perf-topics').innerHTML = `<p class="muted">Did not appear in the contest.</p>`; $('perf-table').innerHTML = ''; $('perf-modal').classList.remove('hidden'); return; }
  const totalQ = dashData.summary.totalQuestions;
  const rank = dashData.users.slice().sort((a, b) => b.computedScore - a.computedScore).findIndex((x) => x.username === u.username) + 1;
  $('perf-stats').innerHTML = [['Solved', `${u.solved}/${totalQ}`], ['Score', u.computedScore], ['Completion', Math.round((u.solved / totalQ) * 100) + '%'], ['Attempted', u.attempted], ['Contest rank', `#${rank}`]]
    .map(([l, v]) => `<div class="stat"><div class="value">${v}</div><div class="label">${l}</div></div>`).join('');
  const tm = new Map();
  for (const q of dashData.questions) { const t = dashTopics[q.name] || splitTitle(q.name).tag || 'Other'; if (!tm.has(t)) tm.set(t, { total: 0, solved: 0 }); const e = tm.get(t); e.total++; if (u.questionStatus[q.name]?.solved) e.solved++; }
  $('perf-topics').innerHTML = `<div class="muted" style="margin-bottom:6px">By topic</div>` + Array.from(tm.entries()).map(([t, e]) => { const cls = e.solved === e.total ? 'solved' : e.solved > 0 ? 'attempted' : 'none'; return `<span class="topic-tag"><b>${esc(t)}</b> <span class="badge ${cls}">${e.solved}/${e.total}</span></span>`; }).join('');
  const qrows = dashData.questions.map((q) => ({ q, st: u.questionStatus[q.name] || { score: 0, points: q.points, solved: false, attempted: false } }));
  $('perf-table').innerHTML = `<thead><tr><th>#</th><th>Question</th><th>Status</th><th class="num">Score</th></tr></thead><tbody>` +
    qrows.map(({ q, st }, i) => { const cls = st.solved ? 'solved' : st.attempted ? 'attempted' : 'none'; const txt = st.solved ? 'Solved' : st.attempted ? 'Attempted' : 'Not attempted'; const url = questionUrl(q); const name = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(q.name)}</a>` : esc(q.name); return `<tr><td class="num">${i + 1}</td><td>${name}</td><td><span class="badge ${cls}">${txt}</span></td><td class="num">${st.score || 0} / ${q.points}</td></tr>`; }).join('') + `</tbody>`;
  $('perf-modal').classList.remove('hidden');
}

// ---- Tabs (Dashboard / Daily) ----
document.querySelectorAll('#view-tabs .tab').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#view-tabs .tab').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  const t = b.dataset.vtab;
  $('tab-dashboard').classList.toggle('hidden', t !== 'dashboard');
  $('tab-daily').classList.toggle('hidden', t !== 'daily');
}));

// ---- Daily questions completed ----
function fmtDay(iso) { const d = new Date(iso + 'T00:00:00'); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
function renderDaily() {
  const t = $('daily-table');
  if (!dailyData || !dailyData.days || !dailyData.days.length) {
    t.innerHTML = `<tbody><tr><td class="muted">No daily snapshots yet — this contest needs to be synced on at least one day to build history.</td></tr></tbody>`;
    $('daily-note').textContent = '';
    return;
  }
  const { days, students } = dailyData;
  $('daily-note').textContent = `· ${students.length} students · ${days.length} day(s)`;
  t.innerHTML =
    `<thead><tr><th class="sticky-name">Student</th>${days.map((day) => `<th class="num">${esc(fmtDay(day))}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>` +
    students.map((s) => `<tr><td class="sticky-name">${esc(s.name || s.hrUsername)}</td>${s.daily.map((n) => `<td class="num">${n ? n : '<span class="muted">·</span>'}</td>`).join('')}<td class="num">${s.total}</td></tr>`).join('') +
    `</tbody>`;
}

boot();
