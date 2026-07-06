// HackerRank Admin Dashboard — admin frontend.
const $ = (id) => document.getElementById(id);
let adminToken = localStorage.getItem('hradmin_token') || '';
let hrToken = '';
let colleges = [];
let roster = [];        // current college roster
let dashData = null;    // latest scrape dashboard for current contest
let selectedCollegeId = '';
let selectedContestId = '';
let dashContests = [];  // contests of the selected dashboard college
let solvedFilter = null; // completion-breakdown filter (number of solved) or null
let studentsPage = 1;
const STUDENTS_PAGE = 50;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setStatus = (el, m, k = 'info') => { el.textContent = m; el.className = `status ${k}`; };

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth && adminToken) headers['x-admin-token'] = adminToken;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth) { logout(); throw new Error(data.error || 'Session expired.'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- Admin auth ----------
$('admin-login-btn').addEventListener('click', adminLogin);
$('admin-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') adminLogin(); });
async function adminLogin() {
  try {
    const d = await api('/api/admin/login', { method: 'POST', auth: false, body: { username: $('admin-user').value.trim(), password: $('admin-pass').value } });
    adminToken = d.token; localStorage.setItem('hradmin_token', adminToken);
    enterApp();
    if (d.defaultCreds) setStatus($('dash-status'), 'Using default admin/admin — set ADMIN_USER & ADMIN_PASS env vars to secure this.', 'info');
  } catch (e) { setStatus($('admin-login-status'), e.message, 'err'); }
}
function logout() { adminToken = ''; localStorage.removeItem('hradmin_token'); $('app').classList.add('hidden'); $('login-screen').classList.remove('hidden'); }
$('logout-btn').addEventListener('click', logout);

async function enterApp() {
  $('login-screen').classList.add('hidden'); $('app').classList.remove('hidden');
  await loadColleges();
  loadAutoSyncStatus();
}
async function loadAutoSyncStatus() {
  try {
    const s = await api('/api/auto-sync/status');
    const when = s.lastRun ? new Date(s.lastRun).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
    $('auto-sync-note').textContent = s.enabled
      ? `Auto-sync ON at ${s.times.join(', ')} · last run: ${when}${s.lastResult ? ' (' + s.lastResult + ')' : ''}`
      : 'Auto-sync off — enable with AUTO_SYNC=1 (needs HR_EMAIL/HR_PASS).';
  } catch { /* ignore */ }
}

// ---------- Tabs ----------
document.querySelectorAll('#tabs .tab').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#tabs .tab').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + b.dataset.tab));
}));

// ---------- Colleges ----------
async function loadColleges() {
  colleges = (await api('/api/colleges')).colleges || [];
  renderCollegesTable();
  fillCollegeSelect($('dash-college')); fillCollegeSelect($('up-college')); fillCollegeSelect($('t-college')); fillCollegeSelect($('cc-college'));
  loadUploadContests(); loadCollegeContests();
  if (!selectedCollegeId && colleges[0]) selectedCollegeId = String(colleges[0].id);
  if (selectedCollegeId) { $('dash-college').value = selectedCollegeId; await loadDashContests(); }
}
function fillCollegeSelect(sel) {
  const prev = sel.value;
  sel.innerHTML = colleges.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') || `<option value="">No colleges yet</option>`;
  if (colleges.some((c) => String(c.id) === prev)) sel.value = prev;
}
function renderCollegesTable() {
  $('c-count').textContent = `· ${colleges.length}`;
  $('colleges-table').innerHTML =
    `<thead><tr><th>College</th><th class="num">Students</th><th>Code</th><th>Set code</th><th></th></tr></thead><tbody>` +
    (colleges.length ? colleges.map((c) =>
      `<tr><td>${esc(c.name)}</td><td class="num">${c.students}</td>` +
      `<td>${c.hasCode ? '<span class="chip code">set</span>' : '<span class="chip nocode">none</span>'}</td>` +
      `<td><input class="code-input" data-id="${c.id}" placeholder="new code" style="min-width:110px"/> <button class="ghost sm" data-savecode="${c.id}">Save</button></td>` +
      `<td><button class="ghost sm danger" data-delc="${c.id}">Delete</button></td></tr>`).join('')
      : `<tr><td colspan="5" class="muted">No colleges yet.</td></tr>`) + `</tbody>`;
}
$('c-add').addEventListener('click', async () => {
  const name = $('c-name').value.trim();
  if (!name) return setStatus($('c-status'), 'Enter a college name.', 'err');
  try {
    await api('/api/colleges', { method: 'POST', body: { name, accessCode: $('c-code').value.trim() } });
    $('c-name').value = ''; $('c-code').value = '';
    setStatus($('c-status'), `Added "${name}".`, 'ok'); await loadColleges();
  } catch (e) { setStatus($('c-status'), e.message, 'err'); }
});
$('colleges-table').addEventListener('click', async (e) => {
  const sc = e.target.closest('[data-savecode]'); const dc = e.target.closest('[data-delc]');
  if (sc) {
    const id = sc.dataset.savecode;
    const code = $('colleges-table').querySelector(`.code-input[data-id="${id}"]`).value.trim();
    if (!code) return setStatus($('c-status'), 'Enter a new code.', 'err');
    await api('/api/colleges/' + id, { method: 'PUT', body: { accessCode: code } });
    setStatus($('c-status'), 'Access code saved.', 'ok'); await loadColleges();
  }
  if (dc) { if (!confirm('Delete this college?')) return; await api('/api/colleges/' + dc.dataset.delc, { method: 'DELETE' }); await loadColleges(); }
});

// ---------- Contest links (Colleges tab) ----------
$('cc-college').addEventListener('change', loadCollegeContests);
async function loadCollegeContests() {
  const id = $('cc-college').value;
  const t = $('cc-table');
  if (!id) { t.innerHTML = ''; return; }
  const contests = (await api('/api/contests?collegeId=' + id)).contests || [];
  t.innerHTML =
    `<thead><tr><th>#</th><th>Contest</th><th>Slug</th><th>Link</th><th></th></tr></thead><tbody>` +
    (contests.length ? contests.map((c, i) =>
      `<tr><td class="num">${i + 1}</td><td>${esc(c.name)}</td><td>${c.slug ? esc(c.slug) : '<span class="muted">—</span>'}</td><td class="muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${esc(c.contestUrl || '—')}</td><td><button class="ghost sm danger" data-delcc="${c.id}">Delete</button></td></tr>`).join('')
      : `<tr><td colspan="5" class="muted">No contests yet.</td></tr>`) + `</tbody>`;
}
async function refreshContestSelectors(collegeId) {
  await loadCollegeContests();
  if (String(collegeId) === String(selectedCollegeId)) await loadDashContests();
  if (String(collegeId) === String($('up-college').value)) await loadUploadContests();
}
$('cc-add').addEventListener('click', async () => {
  const id = $('cc-college').value;
  if (!id) return setStatus($('cc-status'), 'Pick a college.', 'err');
  const name = $('cc-name').value.trim(); const link = $('cc-link').value.trim();
  if (!name) return setStatus($('cc-status'), 'Enter a contest name.', 'err');
  try {
    await api('/api/contests', { method: 'POST', body: { collegeId: id, name, contestUrl: link } });
    $('cc-name').value = ''; $('cc-link').value = '';
    setStatus($('cc-status'), `Added "${name}".`, 'ok');
    await refreshContestSelectors(id);
  } catch (e) { setStatus($('cc-status'), e.message, 'err'); }
});
$('cc-bulk-add').addEventListener('click', async () => {
  const id = $('cc-college').value;
  if (!id) return setStatus($('cc-status'), 'Pick a college.', 'err');
  const links = $('cc-bulk').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!links.length) return setStatus($('cc-status'), 'Paste at least one link.', 'err');
  const existing = (await api('/api/contests?collegeId=' + id)).contests || [];
  let n = existing.length;
  try {
    for (const link of links) { n++; await api('/api/contests', { method: 'POST', body: { collegeId: id, name: 'Contest ' + n, contestUrl: link } }); }
    $('cc-bulk').value = '';
    setStatus($('cc-status'), `Added ${links.length} contest(s).`, 'ok');
    await refreshContestSelectors(id);
  } catch (e) { setStatus($('cc-status'), e.message, 'err'); }
});
$('cc-table').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-delcc]');
  if (!del) return;
  if (!confirm('Delete this contest?')) return;
  await api('/api/contests/' + del.dataset.delcc, { method: 'DELETE' });
  await refreshContestSelectors($('cc-college').value);
});

// ---------- Upload roster ----------
$('up-college').addEventListener('change', loadUploadContests);
async function loadUploadContests() {
  const id = $('up-college').value;
  const sel = $('up-contest');
  if (!id) { sel.innerHTML = `<option value="">(no college)</option>`; return; }
  const contests = (await api('/api/contests?collegeId=' + id)).contests || [];
  sel.innerHTML = `<option value="">College only (no contest)</option>` + contests.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}
function pickCol(h, kws, exclude = []) {
  const ex = new Set(exclude.filter((i) => i >= 0));
  const n = h.map((x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const k of kws) { for (let i = 0; i < n.length; i++) { if (ex.has(i)) continue; if (n[i].includes(k)) return i; } }
  return -1;
}
$('up-file').addEventListener('change', async (e) => {
  const file = e.target.files[0]; const sel = $('up-college'); const college = sel.options[sel.selectedIndex]?.textContent;
  if (!file || !college) return setStatus($('up-status'), 'Pick a college first.', 'err');
  setStatus($('up-status'), 'Reading…', 'info');
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' });
    if (!rows.length) throw new Error('Empty file.');
    const h = rows[0];
    const col = {};
    // Detect the username column FIRST, then exclude it from every other match
    // (so "HackerRank Username" can't be mistaken for the Name column).
    col.user = pickCol(h, ['hackerrankusername', 'hackerrankid', 'hackerrankurl', 'hackerrank', 'username', 'handle', 'user', 'url']);
    if (col.user === -1) throw new Error('No HackerRank username/URL column found.');
    const ex = [col.user];
    col.name = pickCol(h, ['studentname', 'fullname', 'name'], ex);
    col.reg = pickCol(h, ['registernumber', 'registerno', 'rollno', 'roll', 'regno'], ex);
    col.email = pickCol(h, ['emailid', 'email', 'mail'], ex);
    col.dept = pickCol(h, ['department', 'dept', 'branch'], ex);
    col.section = pickCol(h, ['section', 'batch'], ex);
    col.year = pickCol(h, ['year'], ex);
    col.campus = pickCol(h, ['campusname', 'campus'], ex);
    const cleanUser = (v) => { v = String(v).trim(); if (!v) return ''; if (v.includes('/')) { const p = v.split('/').filter(Boolean); return p[p.length - 1]; } return v.replace(/^@/, ''); };
    const students = [];
    for (let r = 1; r < rows.length; r++) {
      const u = cleanUser(rows[r][col.user]); if (!u) continue;
      students.push({ hrUsername: u, name: col.name !== -1 ? String(rows[r][col.name]).trim() : '', registerNo: col.reg !== -1 ? String(rows[r][col.reg]).trim() : '', email: col.email !== -1 ? String(rows[r][col.email]).trim() : '', department: col.dept !== -1 ? String(rows[r][col.dept]).trim() : '', section: col.section !== -1 ? String(rows[r][col.section]).trim() : '', year: col.year !== -1 ? String(rows[r][col.year]).trim() : '', campus: col.campus !== -1 ? String(rows[r][col.campus]).trim() : '' });
    }
    if (!students.length) throw new Error('No student rows with a username.');
    const contestId = $('up-contest').value;
    const res = await api('/api/students/upload', { method: 'POST', body: { college, students, contestId: contestId || undefined } });
    const ctName = contestId ? ($('up-contest').options[$('up-contest').selectedIndex]?.textContent) : '';
    const warn = col.name === -1 ? ' ⚠ No NAME column detected — names will show as usernames. Check your header row.' : '';
    setStatus($('up-status'), `Uploaded ${res.count} students to ${college}${contestId ? ` and mapped ${res.assigned} to "${ctName}"` : ''}.${warn}`, col.name === -1 ? 'err' : 'ok');
    $('up-detected').innerHTML =
      `<div>Detected → <b>name:</b> ${lbl(h, col.name)} · <b>user:</b> ${lbl(h, col.user)} · <b>reg:</b> ${lbl(h, col.reg)} · <b>email:</b> ${lbl(h, col.email)} · <b>dept:</b> ${lbl(h, col.dept)} · <b>section:</b> ${lbl(h, col.section)} · <b>year:</b> ${lbl(h, col.year)}</div>` +
      `<div style="margin-top:4px">Your sheet's headers: ${h.map((x) => `<code>${esc(String(x))}</code>`).join(', ')}</div>`;
    await loadColleges();
  } catch (err) { setStatus($('up-status'), err.message, 'err'); }
  finally { e.target.value = ''; }
});
const lbl = (h, i) => (i === -1 ? '—' : `"${h[i]}"`);
$('up-template').addEventListener('click', () => {
  const ws = XLSX.utils.aoa_to_sheet([['Student Name', 'HackerRank Username', 'Register Number', 'Email ID', 'Department', 'Section', 'Year', 'Campus name']]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Roster'); XLSX.writeFile(wb, 'roster_template.xlsx');
});

// ---------- Connect HackerRank ----------
$('connect-btn').addEventListener('click', () => $('connect-modal').classList.remove('hidden'));
$('hr-cancel').addEventListener('click', () => $('connect-modal').classList.add('hidden'));
$('hr-connect-btn').addEventListener('click', async () => {
  setStatus($('hr-connect-status'), 'Connecting…', 'info');
  try {
    const d = await api('/api/hr/connect', { method: 'POST', body: { email: $('hr-email').value.trim(), password: $('hr-pass').value } });
    hrToken = d.hrToken;
    $('hr-pill').textContent = d.mock ? 'HR: mock' : 'HR: connected'; $('hr-pill').className = 'pill';
    $('connect-modal').classList.add('hidden');
    setStatus($('dash-status'), 'HackerRank connected. Click Sync now.', 'ok');
  } catch (e) { setStatus($('hr-connect-status'), e.message, 'err'); }
});

// ---------- Dashboard ----------
const collegeName = (id) => { const c = colleges.find((x) => String(x.id) === String(id)); return c ? c.name : ''; };
$('dash-college').addEventListener('change', async (e) => { selectedCollegeId = e.target.value; selectedContestId = ''; await loadDashContests(); });
$('dash-contest').addEventListener('change', (e) => { selectedContestId = e.target.value; loadDashboard(); });
$('sync-btn').addEventListener('click', syncContest);
$('autosync-btn').addEventListener('click', async () => {
  setStatus($('dash-status'), 'Running auto-sync for all contests… this can take a while.', 'info');
  try {
    await api('/api/auto-sync/run', { method: 'POST' });
    // Poll status until it finishes.
    const poll = setInterval(async () => {
      const s = await api('/api/auto-sync/status');
      if (!s.running) {
        clearInterval(poll);
        setStatus($('dash-status'), `Auto-sync done — ${s.lastResult || ''}`, 'ok');
        loadAutoSyncStatus(); loadDashboard();
      }
    }, 2000);
  } catch (e) { setStatus($('dash-status'), e.message, 'err'); }
});
$('share-btn').addEventListener('click', shareContest);
$('contest-add').addEventListener('click', addContest);
async function shareContest() {
  if (!selectedContestId) return setStatus($('dash-status'), 'Select a contest first.', 'err');
  try {
    const r = await api('/api/contests/' + selectedContestId + '/share', { method: 'POST' });
    const url = location.origin + '/view/' + r.token;
    try { await navigator.clipboard.writeText(url); setStatus($('dash-status'), `Read-only link copied: ${url}`, 'ok'); }
    catch { window.prompt('Read-only dashboard link (copy it):', url); }
  } catch (e) { setStatus($('dash-status'), e.message, 'err'); }
}
$('contest-del').addEventListener('click', delContest);
['f-department', 'f-section', 'f-year'].forEach((id) => $(id).addEventListener('change', () => { studentsPage = 1; renderStudents(); }));
$('f-search').addEventListener('input', () => { studentsPage = 1; renderStudents(); });

async function loadDashContests() {
  if (!selectedCollegeId) return;
  dashContests = (await api('/api/contests?collegeId=' + selectedCollegeId)).contests || [];
  const sel = $('dash-contest');
  sel.innerHTML = dashContests.map((c) => `<option value="${c.id}">${esc(c.name)}${c.slug ? '' : ' (no link)'}</option>`).join('') || `<option value="">No contests</option>`;
  if (!dashContests.some((c) => String(c.id) === selectedContestId)) selectedContestId = dashContests[0] ? String(dashContests[0].id) : '';
  sel.value = selectedContestId;
  await loadDashboard();
}
async function addContest() {
  if (!selectedCollegeId) return setStatus($('dash-status'), 'Pick a college first.', 'err');
  const name = prompt('Contest name (e.g. Round 1):'); if (!name) return;
  const contestUrl = prompt('HackerRank contest link:') || '';
  try { const r = await api('/api/contests', { method: 'POST', body: { collegeId: selectedCollegeId, name, contestUrl } }); selectedContestId = String(r.contest.id); await loadDashContests(); setStatus($('dash-status'), `Added "${name}". Connect HackerRank and Sync it.`, 'ok'); }
  catch (e) { setStatus($('dash-status'), e.message, 'err'); }
}
async function delContest() {
  if (!selectedContestId) return;
  if (!confirm('Delete this contest?')) return;
  await api('/api/contests/' + selectedContestId, { method: 'DELETE' });
  selectedContestId = ''; await loadDashContests();
}

function showContestLink() {
  const ct = dashContests.find((c) => String(c.id) === String(selectedContestId));
  $('dash-contest-url').value = ct ? (ct.contestUrl || '') : '';
}
$('dash-savelink').addEventListener('click', async () => {
  if (!selectedContestId) return setStatus($('dash-status'), 'Select a contest first.', 'err');
  try { await api('/api/contests/' + selectedContestId, { method: 'PUT', body: { contestUrl: $('dash-contest-url').value.trim() } }); setStatus($('dash-status'), 'Contest link saved. Sync it now.', 'ok'); await loadDashContests(); }
  catch (e) { setStatus($('dash-status'), e.message, 'err'); }
});

async function loadDashboard() {
  solvedFilter = null;
  studentsPage = 1;
  showContestLink();
  roster = selectedCollegeId ? (await api('/api/students?college=' + encodeURIComponent(collegeName(selectedCollegeId)))).students || [] : [];
  if (!selectedContestId) { dashData = null; dashTopics = {}; fillFilters(); renderSummary(); renderTopicAnalysis(); renderStudents(); setStatus($('dash-status'), 'No contest yet — add one with ＋ Contest.', 'info'); return; }
  const d = await api('/api/contest-dashboard/' + selectedContestId);
  dashData = d.dashboard;
  dashTopics = d.topics || {};
  dashCats = d.categories || {};
  roster = d.students || [];  // students mapped to this contest (falls back to whole college if none mapped)
  fillFilters();
  renderSummary();
  renderTopicAnalysis();
  renderCompletion();
  renderCategoryChart();
  renderStudents();
  setStatus($('dash-status'), dashData ? '' : `"${d.contest.name}" not synced yet. Connect HackerRank and Sync now.`, 'info');
}

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
    rows.map((r) => `<tr><td>${esc(r.topic)}</td><td class="num">${r.questions}</td><td class="num">${r.solveRate}%</td></tr>`).join('') +
    `</tbody>`;

  // Topic × category completion matrix
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
    }).join('')}</tr>`).join('') +
    `</tbody>`;
  card.classList.remove('hidden');
}

// ---- Topic × category: who completed / who didn't ----
let tcCellMap = {}, tcRows = [], tcFilter = 'all', tcPage = 1;
const TC_PAGE = 20;
$('cat-topic-table').addEventListener('click', (e) => {
  const td = e.target.closest('td.tcell[data-topic]');
  if (td) openTopicCat(td.dataset.topic, td.dataset.cat);
});
function openTopicCat(topic, cat) {
  const entry = tcCellMap[topic] && tcCellMap[topic][cat];
  if (!entry) return;
  const qs = entry.qs;
  const byUser = new Map(dashData.users.map((u) => [u.username.toLowerCase(), u]));
  const rows = [];
  for (const s of roster) {
    const u = byUser.get(s.hrUsername.toLowerCase()); if (!u) continue;
    const solved = qs.filter((qn) => u.questionStatus[qn]?.solved).length;
    rows.push({ name: s.name || s.hrUsername, hrUsername: s.hrUsername, department: s.department, section: s.section, solved, total: qs.length, completed: solved === qs.length });
  }
  const done = rows.filter((r) => r.completed).length;
  tcRows = rows.sort((a, b) => (b.completed - a.completed) || (b.solved - a.solved));
  tcFilter = 'all'; tcPage = 1;
  $('tc-modal-title').textContent = `${topic} · ${CAT_LABELS[cat] || cat} — ${done}/${rows.length} completed (${qs.length} question${qs.length > 1 ? 's' : ''})`;
  renderTcPage();
  $('tc-modal').classList.remove('hidden');
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
function renderCompletion() {
  const card = $('completion-card');
  if (!dashData) { card.classList.add('hidden'); return; }
  const rows = joinedRows();
  if (!rows.length) { card.classList.add('hidden'); return; }
  const totalQ = dashData.summary.totalQuestions;
  const dist = Array.from({ length: totalQ + 1 }, () => 0);
  for (const r of rows) dist[r.solved] = (dist[r.solved] || 0) + 1;
  const total = rows.length;
  const maxCount = Math.max(...dist, 1);
  $('cb-note').textContent = `· ${total} students`;
  $('completion-table').innerHTML =
    `<thead><tr><th>Questions solved</th><th class="num">Students</th><th class="num">%</th><th>Distribution</th></tr></thead><tbody>` +
    dist.map((count, k) =>
      `<tr class="cb-row" data-solved="${k}" style="cursor:pointer">` +
      `<td>${k} / ${totalQ}${k === totalQ ? ' (all)' : k === 0 ? ' (none)' : ''}</td>` +
      `<td class="num">${count}</td><td class="num">${total ? Math.round((count / total) * 100) : 0}%</td>` +
      `<td><div class="bar" style="display:inline-block;width:160px;vertical-align:middle"><span style="width:${Math.round((count / maxCount) * 100)}%"></span></div></td></tr>`).join('') +
    `</tbody>`;
  $('completion-pager').innerHTML = '';
  card.classList.remove('hidden');
}
$('completion-table').addEventListener('click', (e) => {
  const row = e.target.closest('.cb-row[data-solved]');
  if (row) openCompletionNames(Number(row.dataset.solved));
});
let cbRows = [], cbPage = 1;
const CB_PAGE = 20;
function openCompletionNames(k) {
  if (!dashData) return;
  const totalQ = dashData.summary.totalQuestions;
  cbRows = joinedRows().filter((r) => r.solved === k).sort((a, b) => b.score - a.score);
  cbPage = 1;
  $('cb-modal-title').textContent = `${cbRows.length} student(s) solved ${k} / ${totalQ}`;
  renderCbPage();
  $('cb-modal').classList.remove('hidden');
}
function renderCbPage() {
  const total = cbRows.length;
  const pages = Math.max(1, Math.ceil(total / CB_PAGE));
  if (cbPage > pages) cbPage = pages;
  const start = (cbPage - 1) * CB_PAGE;
  const slice = cbRows.slice(start, start + CB_PAGE);
  $('cb-modal-table').innerHTML =
    `<thead><tr><th>#</th><th>Student</th><th>HR username</th><th>Dept</th><th>Section</th><th class="num">Score</th></tr></thead><tbody>` +
    (slice.length ? slice.map((r, idx) => `<tr><td class="num">${start + idx + 1}</td><td><a class="user-link" data-user="${esc(r.hrUsername)}">${esc(r.name || r.hrUsername)}</a></td><td>${esc(r.hrUsername)}</td><td>${esc(r.department || '—')}</td><td>${esc(r.section || '—')}</td><td class="num">${r.score}</td></tr>`).join('')
      : `<tr><td colspan="6" class="muted">No students.</td></tr>`) + `</tbody>`;
  const from = total ? start + 1 : 0;
  $('cb-pager').innerHTML = total > CB_PAGE
    ? `<button class="ghost sm" id="cb-prev" ${cbPage <= 1 ? 'disabled' : ''}>‹ Prev</button><span class="muted">${from}–${Math.min(start + CB_PAGE, total)} of ${total} · page ${cbPage}/${pages}</span><button class="ghost sm" id="cb-next" ${cbPage >= pages ? 'disabled' : ''}>Next ›</button>`
    : '';
  if (total > CB_PAGE) {
    $('cb-prev').addEventListener('click', () => { if (cbPage > 1) { cbPage--; renderCbPage(); } });
    $('cb-next').addEventListener('click', () => { if (cbPage < pages) { cbPage++; renderCbPage(); } });
  }
}
$('cb-modal-close').addEventListener('click', () => $('cb-modal').classList.add('hidden'));
$('cb-modal').addEventListener('click', (e) => { if (e.target.id === 'cb-modal') $('cb-modal').classList.add('hidden'); });
$('cb-modal-table').addEventListener('click', (e) => { const l = e.target.closest('.user-link[data-user]'); if (l) { e.preventDefault(); $('cb-modal').classList.add('hidden'); openPerf(l.dataset.user); } });

let taRows = [];
const heatColor = (p) => `hsl(${Math.round((p / 100) * 120)},70%,${p === 0 ? 30 : 52}%)`;
$('ta-chart-btn').addEventListener('click', () => { if (!taRows.length) return; $('ta-modal-chart').innerHTML = topicChartSVG(taRows); $('ta-modal').classList.remove('hidden'); });
$('ta-modal-close').addEventListener('click', () => $('ta-modal').classList.add('hidden'));
$('ta-modal').addEventListener('click', (e) => { if (e.target.id === 'ta-modal') $('ta-modal').classList.add('hidden'); });
function topicChartSVG(rows) {
  const rowH = 28, top = 8, left = 168, barMax = 320, W = 620, H = top * 2 + rows.length * rowH;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-height:${H}px;font-family:inherit">`;
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const bw = Math.max(2, Math.round((barMax * r.solveRate) / 100));
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
  if (!dashData) { card.classList.add('hidden'); return; }
  const byUser = new Map(dashData.users.map((u) => [u.username.toLowerCase(), u]));
  const participants = roster.map((s) => byUser.get(s.hrUsername.toLowerCase())).filter(Boolean);
  if (!participants.length) { card.classList.add('hidden'); return; }

  const topicQs = new Map();
  for (const q of dashData.questions) {
    const t = dashTopics[q.name] || splitTitle(q.name).tag || 'Other';
    if (!topicQs.has(t)) topicQs.set(t, []);
    topicQs.get(t).push(q.name);
  }
  const rows = Array.from(topicQs.entries()).map(([topic, qs]) => {
    let solved = 0;
    for (const u of participants) for (const qn of qs) if (u.questionStatus[qn]?.solved) solved++;
    const denom = participants.length * qs.length;
    return { topic, questions: qs.length, solveRate: denom ? Math.round((solved / denom) * 100) : 0, avgSolved: +(solved / participants.length).toFixed(2) };
  }).sort((a, b) => b.solveRate - a.solveRate);

  const weakest = rows[rows.length - 1];
  taRows = rows;
  $('ta-note').textContent = `· ${participants.length} participants · ${rows.length} topics · weakest: ${weakest.topic} (${weakest.solveRate}%)`;
  $('ta-chart').innerHTML = topicChartSVG(rows);
  $('topic-analysis-table').innerHTML =
    `<thead><tr><th>#</th><th>Topic</th><th class="num">Questions</th><th class="num">Avg solved / student</th><th>Solve rate</th></tr></thead><tbody>` +
    rows.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.topic)}</td><td class="num">${r.questions}</td><td class="num">${r.avgSolved}</td><td><div class="bar" style="display:inline-block;width:120px;vertical-align:middle"><span style="width:${r.solveRate}%"></span></div> <span class="muted">${r.solveRate}%</span></td></tr>`).join('') +
    `</tbody>`;
  card.classList.remove('hidden');
}
function fillFilters() {
  for (const [id, key] of [['f-department', 'department'], ['f-section', 'section'], ['f-year', 'year']]) {
    const sel = $(id); const prev = sel.value;
    const vals = Array.from(new Set(roster.map((s) => s[key]).filter(Boolean))).sort();
    sel.innerHTML = `<option value="">All ${key === 'department' ? 'departments' : key + 's'}</option>` + vals.map((v) => `<option>${esc(v)}</option>`).join('');
    if (vals.includes(prev)) sel.value = prev;
  }
}
function renderSummary() {
  const sm = $('summary');
  if (!dashData) { sm.classList.add('hidden'); return; }
  sm.classList.remove('hidden');
  const inContest = roster.filter((s) => dashData.users.some((u) => u.username.toLowerCase() === s.hrUsername.toLowerCase())).length;
  sm.innerHTML = [['Students', roster.length], ['In contest', inContest], ['Questions', dashData.summary.totalQuestions], ['Avg solved', dashData.summary.avgSolved], ['Completion', dashData.summary.overallCompletion + '%']]
    .map(([l, v]) => `<div class="stat"><div class="value">${v}</div><div class="label">${l}</div></div>`).join('');
}
function joinedRows() {
  const byUser = new Map((dashData?.users || []).map((u) => [u.username.toLowerCase(), u]));
  return roster.map((s) => {
    const u = byUser.get(s.hrUsername.toLowerCase());
    const totalQ = dashData?.summary.totalQuestions || 0;
    return { ...s, inContest: !!u, solved: u ? u.solved : 0, score: u ? u.computedScore : 0, totalQ, completion: u && totalQ ? Math.round((u.solved / totalQ) * 100) : 0 };
  });
}
function filteredRows() {
  const f = { department: $('f-department').value, section: $('f-section').value, year: $('f-year').value, q: $('f-search').value.trim().toLowerCase() };
  return joinedRows().filter((r) => (!f.department || r.department === f.department) && (!f.section || r.section === f.section) && (!f.year || r.year === f.year) &&
    (!f.q || (r.name || '').toLowerCase().includes(f.q) || (r.hrUsername || '').toLowerCase().includes(f.q)))
    .sort((a, b) => b.solved - a.solved || b.score - a.score);
}
function renderStudents() {
  const all = filteredRows();
  const hasScrape = !!dashData;
  const pages = Math.max(1, Math.ceil(all.length / STUDENTS_PAGE));
  if (studentsPage > pages) studentsPage = pages;
  const start = (studentsPage - 1) * STUDENTS_PAGE;
  const rows = all.slice(start, start + STUDENTS_PAGE);
  $('students-table').innerHTML =
    `<thead><tr><th><input type="checkbox" id="sel-all"/></th><th>#</th><th>Student</th><th>HR username</th><th>Dept</th><th>Section</th>` +
    (hasScrape ? `<th class="num">Solved</th><th class="num">Score</th><th>Completion</th>` : '') + `</tr></thead><tbody>` +
    (rows.length ? rows.map((r, idx) =>
      `<tr><td><input type="checkbox" class="sel" value="${r.id}"/></td><td class="num">${start + idx + 1}</td><td><a class="user-link" data-user="${esc(r.hrUsername)}">${esc(r.name || r.hrUsername)}</a></td><td>${esc(r.hrUsername)}${r.inContest ? '' : ' <span class="muted">·absent</span>'}</td><td>${esc(r.department || '—')}</td><td>${esc(r.section || '—')}</td>` +
      (hasScrape ? `<td class="num">${r.solved}/${r.totalQ}</td><td class="num">${r.score}</td><td><div class="bar"><span style="width:${r.completion}%"></span></div></td>` : '') + `</tr>`).join('')
      : `<tr><td colspan="9" class="muted">No students. Upload a roster (Upload tab).</td></tr>`) + `</tbody>`;
  const selAll = $('sel-all'); if (selAll) selAll.addEventListener('change', () => document.querySelectorAll('#students-table .sel').forEach((c) => (c.checked = selAll.checked)));
  const from = all.length ? start + 1 : 0;
  $('students-pager').innerHTML = all.length > STUDENTS_PAGE
    ? `<button class="ghost sm" id="st-prev" ${studentsPage <= 1 ? 'disabled' : ''}>‹ Prev</button><span class="muted">${from}–${Math.min(start + STUDENTS_PAGE, all.length)} of ${all.length} · page ${studentsPage}/${pages}</span><button class="ghost sm" id="st-next" ${studentsPage >= pages ? 'disabled' : ''}>Next ›</button>`
    : '';
  if (all.length > STUDENTS_PAGE) {
    $('st-prev').addEventListener('click', () => { if (studentsPage > 1) { studentsPage--; renderStudents(); } });
    $('st-next').addEventListener('click', () => { if (studentsPage < pages) { studentsPage++; renderStudents(); } });
  }
}
$('del-btn').addEventListener('click', async () => {
  const ids = Array.from(document.querySelectorAll('#students-table .sel:checked')).map((c) => Number(c.value));
  if (!ids.length) return setStatus($('dash-status'), 'Select students to delete.', 'err');
  if (!confirm(`Delete ${ids.length} student(s)?`)) return;
  await api('/api/students', { method: 'DELETE', body: { ids } });
  await loadDashboard();
});
$('export-btn').addEventListener('click', () => {
  const rows = filteredRows();
  const aoa = [['Name', 'HR Username', 'Register No', 'Email', 'Department', 'Section', 'Year', 'Campus', 'Solved', 'Score', 'Completion %']];
  for (const r of rows) aoa.push([r.name, r.hrUsername, r.registerNo, r.email, r.department, r.section, r.year, r.campus, r.solved, r.score, r.completion]);
  const ws = XLSX.utils.aoa_to_sheet(aoa); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Students'); XLSX.writeFile(wb, 'students.xlsx');
});

// ---------- Daily tab ----------
let dailyCollegeId = '', dailyContestId = '';
document.querySelectorAll('#tabs .tab').forEach((b) => { if (b.dataset.tab === 'daily') b.addEventListener('click', initDailyTab); });
function initDailyTab() { fillCollegeSelect($('daily-college')); if (!dailyCollegeId && colleges[0]) dailyCollegeId = String(colleges[0].id); $('daily-college').value = dailyCollegeId; loadDailyContests(); }
$('daily-college').addEventListener('change', (e) => { dailyCollegeId = e.target.value; dailyContestId = ''; loadDailyContests(); });
$('daily-contest').addEventListener('change', (e) => { dailyContestId = e.target.value; renderDaily(); });
async function loadDailyContests() {
  if (!dailyCollegeId) return;
  const contests = (await api('/api/contests?collegeId=' + dailyCollegeId)).contests || [];
  const sel = $('daily-contest');
  sel.innerHTML = contests.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') || `<option value="">No contests</option>`;
  if (!contests.some((c) => String(c.id) === dailyContestId)) dailyContestId = contests[0] ? String(contests[0].id) : '';
  sel.value = dailyContestId;
  renderDaily();
}
async function renderDaily() {
  const t = $('daily-table');
  if (!dailyContestId) { t.innerHTML = ''; $('daily-note').textContent = ''; return; }
  const d = await api('/api/daily/' + dailyContestId);
  if (!d.days.length) { t.innerHTML = `<tbody><tr><td class="muted">No snapshots yet — sync this contest on at least one day (ideally daily) to build history.</td></tr></tbody>`; $('daily-note').textContent = ''; return; }
  $('daily-note').textContent = `· ${d.students.length} students · ${d.days.length} day(s)`;
  const fmtDay = (s) => { const dt = new Date(s + 'T00:00'); return isNaN(dt) ? s : dt.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  t.innerHTML =
    `<thead><tr><th class="sticky-name">Student</th>${d.days.map((day) => `<th class="num">${esc(fmtDay(day))}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>` +
    (d.students.length ? d.students.map((s) =>
      `<tr><td class="sticky-name">${esc(s.name || s.hrUsername)}</td>${s.daily.map((n) => `<td class="num">${n ? n : '<span class="muted">·</span>'}</td>`).join('')}<td class="num">${s.total}</td></tr>`).join('')
      : `<tr><td class="muted">No students mapped to this contest.</td></tr>`) + `</tbody>`;
}

// ---------- Topics tab ----------
let topicsCollegeId = '', topicsContestId = '', topicsContests = [];
document.querySelectorAll('#tabs .tab').forEach((b) => { if (b.dataset.tab === 'topics') b.addEventListener('click', initTopicsTab); });
function initTopicsTab() { fillCollegeSelect($('t-college')); if (!topicsCollegeId && colleges[0]) topicsCollegeId = String(colleges[0].id); $('t-college').value = topicsCollegeId; loadTopicsContests(); }
$('t-college').addEventListener('change', (e) => { topicsCollegeId = e.target.value; topicsContestId = ''; loadTopicsContests(); });
$('t-contest-sel').addEventListener('change', (e) => { topicsContestId = e.target.value; loadTopicsEditor(); });
async function loadTopicsContests() {
  if (!topicsCollegeId) return;
  topicsContests = (await api('/api/contests?collegeId=' + topicsCollegeId)).contests || [];
  const sel = $('t-contest-sel');
  sel.innerHTML = topicsContests.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') || `<option value="">No contests</option>`;
  if (!topicsContests.some((c) => String(c.id) === topicsContestId)) topicsContestId = topicsContests[0] ? String(topicsContests[0].id) : '';
  sel.value = topicsContestId;
  loadTopicsEditor();
}
async function loadTopicsEditor() {
  if (!topicsContestId) { $('topics-table').innerHTML = ''; $('t-contest').value = ''; setStatus($('t-status'), 'No contests for this college — add one in the Dashboard tab.', 'info'); return; }
  const d = await api('/api/topics/' + topicsContestId);
  $('t-contest').value = d.contestUrl || '';
  if (!d.contestUrl) { $('topics-table').innerHTML = ''; setStatus($('t-status'), 'This contest has no link. Set it above and Save link.', 'info'); return; }
  if (!d.hasScrape) { $('topics-table').innerHTML = ''; $('topic-videos-card').classList.add('hidden'); setStatus($('t-status'), `Contest "${d.slug}" not synced yet. Sync it in the Dashboard tab to load its questions.`, 'info'); return; }
  setStatus($('t-status'), `${d.questions.length} questions in ${d.slug}.`, 'info');
  $('topics-table').innerHTML =
    `<thead><tr><th>#</th><th>Question</th><th>Topic</th><th>Category</th></tr></thead><tbody>` +
    d.questions.map((q, i) => `<tr><td class="num">${i + 1}</td><td>${esc(q.name)}</td>` +
      `<td><input class="topic-in" data-q="${esc(q.name)}" data-sug="${esc(q.suggested)}" value="${esc(q.topic)}" placeholder="${esc(q.suggested || 'topic')}" style="min-width:180px"/></td>` +
      `<td><select class="qcat-in" data-q="${esc(q.name)}">${QCATS.map(([v, l]) => `<option value="${v}" ${q.category === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td></tr>`).join('') +
    `</tbody>`;
  loadTopicVideos();
}
async function loadTopicVideos() {
  const card = $('topic-videos-card');
  if (!topicsContestId) { card.classList.add('hidden'); return; }
  const d = await api('/api/topic-videos/' + topicsContestId);
  if (!d.hasScrape || !d.topics.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  $('tv-table').innerHTML =
    `<thead><tr><th>Topic</th><th>Video links (one per line)</th></tr></thead><tbody>` +
    d.topics.map((t) => `<tr><td>${esc(t.name)}</td><td><textarea class="tv-in" data-topic="${esc(t.name)}" rows="2" placeholder="https://youtu.be/…&#10;https://youtu.be/… (one per line)" style="min-width:300px">${esc((t.videos || []).join('\n'))}</textarea></td></tr>`).join('') +
    `</tbody>`;
  loadQuestionCategories();
}
const QCATS = [['', '—'], ['inclass', 'In-class'], ['postclass', 'Post-class'], ['challenges', 'Challenges']];
$('tv-save').addEventListener('click', async () => {
  if (!topicsContestId) return;
  const map = {};
  document.querySelectorAll('#tv-table .tv-in').forEach((inp) => { if (inp.value.trim()) map[inp.dataset.topic] = inp.value; });
  try { const r = await api('/api/topic-videos/' + topicsContestId, { method: 'POST', body: { map } }); setStatus($('tv-status'), `Saved ${r.count} topic video(s).`, 'ok'); }
  catch (e) { setStatus($('tv-status'), e.message, 'err'); }
});
$('t-savelink').addEventListener('click', async () => {
  if (!topicsContestId) return;
  try {
    await api('/api/contests/' + topicsContestId, { method: 'PUT', body: { contestUrl: $('t-contest').value.trim() } });
    setStatus($('t-status'), 'Contest link saved. Now sync it in the Dashboard tab.', 'ok');
    await loadTopicsContests();
  } catch (e) { setStatus($('t-status'), e.message, 'err'); }
});
$('t-autofill').addEventListener('click', () => document.querySelectorAll('#topics-table .topic-in').forEach((inp) => { if (!inp.value.trim() && inp.dataset.sug) inp.value = inp.dataset.sug; }));
$('t-save').addEventListener('click', async () => {
  if (!topicsContestId) return;
  const map = {};
  document.querySelectorAll('#topics-table .topic-in').forEach((inp) => { if (inp.value.trim()) map[inp.dataset.q] = inp.value.trim(); });
  const catMap = {};
  document.querySelectorAll('#topics-table .qcat-in').forEach((sel) => { if (sel.value) catMap[sel.dataset.q] = sel.value; });
  try {
    const r = await api('/api/topics/' + topicsContestId, { method: 'POST', body: { map } });
    await api('/api/question-categories/' + topicsContestId, { method: 'POST', body: { map: catMap } });
    setStatus($('t-status'), `Saved ${r.count} topics and ${Object.keys(catMap).length} categories.`, 'ok');
    loadTopicVideos(); if (String(topicsContestId) === String(selectedContestId)) loadDashboard();
  }
  catch (e) { setStatus($('t-status'), e.message, 'err'); }
});

// ---------- Student performance modal ----------
let dashTopics = {}; // saved question->topic for current college
let dashCats = {};   // saved question->category for current contest
function questionUrl(q) { const u = q.url; if (!u || u === '#') return null; return u.startsWith('http') ? u : 'https://www.hackerrank.com' + (u.startsWith('/') ? u : '/' + u); }
function splitTitle(name) { const m = String(name).split(/\s+[–—-]\s+/); return m.length >= 2 ? { tag: m[0].trim(), title: m.slice(1).join(' - ').trim() } : { tag: '', title: String(name) }; }

document.getElementById('students-table').addEventListener('click', (e) => {
  const link = e.target.closest('.user-link[data-user]');
  if (link) { e.preventDefault(); openPerf(link.dataset.user); }
});
$('perf-close').addEventListener('click', () => $('perf-modal').classList.add('hidden'));
$('perf-modal').addEventListener('click', (e) => { if (e.target.id === 'perf-modal') $('perf-modal').classList.add('hidden'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('perf-modal').classList.add('hidden'); });

function openPerf(hrUsername) {
  const r = joinedRows().find((x) => x.hrUsername.toLowerCase() === hrUsername.toLowerCase());
  if (!r) return;
  const u = dashData?.users.find((x) => x.username.toLowerCase() === hrUsername.toLowerCase());
  $('perf-title').textContent = r.name || hrUsername;
  $('perf-meta').innerHTML = [
    `@${esc(hrUsername)}`, r.registerNo && `Reg: ${esc(r.registerNo)}`, r.department && esc(r.department),
    r.section && `Sec ${esc(r.section)}`, r.year && `Year ${esc(r.year)}`, r.email && esc(r.email),
  ].filter(Boolean).join(' · ');

  if (!dashData || !u) {
    $('perf-stats').innerHTML = `<div class="stat"><div class="value">—</div><div class="label">No contest data</div></div>`;
    $('perf-topics').innerHTML = `<p class="muted">${dashData ? 'This student did not appear in the contest scrape.' : 'No contest synced yet for this college.'}</p>`;
    $('perf-table').innerHTML = '';
    $('perf-modal').classList.remove('hidden');
    return;
  }

  const totalQ = dashData.summary.totalQuestions;
  const contestRank = dashData.users.slice().sort((a, b) => b.computedScore - a.computedScore).findIndex((x) => x.username === u.username) + 1;
  $('perf-stats').innerHTML = [
    ['Solved', `${u.solved}/${totalQ}`], ['Score', u.computedScore], ['Completion', Math.round((u.solved / totalQ) * 100) + '%'],
    ['Attempted', u.attempted], ['Contest rank', `#${contestRank}`],
  ].map(([l, v]) => `<div class="stat"><div class="value">${v}</div><div class="label">${l}</div></div>`).join('');

  // Per-topic breakdown (parsed from "Topic - Title")
  const topicMap = new Map();
  for (const q of dashData.questions) {
    const t = dashTopics[q.name] || splitTitle(q.name).tag || 'Other';
    if (!topicMap.has(t)) topicMap.set(t, { total: 0, solved: 0 });
    const e = topicMap.get(t); e.total++; if (u.questionStatus[q.name]?.solved) e.solved++;
  }
  $('perf-topics').innerHTML = `<div class="muted" style="margin-bottom:6px">By topic</div>` +
    Array.from(topicMap.entries()).map(([t, e]) => {
      const cls = e.solved === e.total ? 'solved' : e.solved > 0 ? 'attempted' : 'none';
      return `<span class="topic-tag"><b>${esc(t)}</b> <span class="badge ${cls}">${e.solved}/${e.total}</span></span>`;
    }).join('');

  const rows = dashData.questions.map((q) => ({ q, st: u.questionStatus[q.name] || { score: 0, points: q.points, solved: false, attempted: false } }));
  $('perf-table').innerHTML =
    `<thead><tr><th>#</th><th>Question</th><th>Status</th><th class="num">Score</th></tr></thead><tbody>` +
    rows.map(({ q, st }, i) => {
      const cls = st.solved ? 'solved' : st.attempted ? 'attempted' : 'none';
      const txt = st.solved ? 'Solved' : st.attempted ? 'Attempted' : 'Not attempted';
      const url = questionUrl(q);
      const name = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(q.name)}</a>` : esc(q.name);
      return `<tr><td class="num">${i + 1}</td><td>${name}</td><td><span class="badge ${cls}">${txt}</span></td><td class="num">${st.score || 0} / ${q.points}</td></tr>`;
    }).join('') + `</tbody>`;
  $('perf-modal').classList.remove('hidden');
}

// ---------- Sync (scrape) ----------
function syncContest() {
  if (!selectedContestId) return setStatus($('dash-status'), 'Add or select a contest first.', 'err');
  if (!hrToken) { $('connect-modal').classList.remove('hidden'); return; }
  const ct = dashContests.find((c) => String(c.id) === String(selectedContestId));
  if (!ct || !ct.slug) return setStatus($('dash-status'), 'This contest has no link — delete and re-add it with a link.', 'err');
  $('sync-btn').disabled = true;
  $('dash-progress').classList.remove('hidden'); $('dash-prog-lab').textContent = 'Starting…'; $('dash-prog-fill').style.width = '0%';
  setStatus($('dash-status'), `Syncing ${ct.name}…`, 'info');
  const es = new EventSource('/api/scrape-stream?' + new URLSearchParams({ adminToken, hrToken, contestId: selectedContestId }));
  es.addEventListener('progress', (ev) => { const p = JSON.parse(ev.data); $('dash-prog-lab').textContent = p.phase === 'leaderboard' ? `Fetching leaderboard… ${p.completed}` : `${p.completed} / ${p.total} users`; $('dash-prog-fill').style.width = (p.total ? Math.round(p.completed / p.total * 100) : 8) + '%'; });
  es.addEventListener('done', (ev) => { es.close(); $('sync-btn').disabled = false; $('dash-prog-fill').style.width = '100%'; const d = JSON.parse(ev.data); setStatus($('dash-status'), `Synced — ${d.summary.totalUsers} users, ${d.summary.totalQuestions} questions.`, 'ok'); loadDashboard(); });
  es.addEventListener('failed', (ev) => { es.close(); $('sync-btn').disabled = false; $('dash-progress').classList.add('hidden'); setStatus($('dash-status'), JSON.parse(ev.data).error, 'err'); });
  es.onerror = () => { es.close(); $('sync-btn').disabled = false; };
}

// ---------- Boot ----------
if (adminToken) enterApp().catch(logout); else { $('login-screen').classList.remove('hidden'); }
