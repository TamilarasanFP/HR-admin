// Storage layer — local SQLite (node:sqlite) with a JSON-file fallback.
// All functions are synchronous; server awaits them harmlessly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let backend = 'json';
let sql = null;
try {
  if (process.env.STORAGE === 'json') throw new Error('forced JSON');
  const mod = await import('node:sqlite');
  sql = new mod.DatabaseSync(path.join(DATA_DIR, 'app.db'));
  sql.exec(`
    CREATE TABLE IF NOT EXISTS colleges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE, access_code TEXT, contest_url TEXT, slug TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      college TEXT, name TEXT, hr_username TEXT, username_key TEXT,
      register_no TEXT, email TEXT, department TEXT, section TEXT, year TEXT, campus TEXT,
      UNIQUE(college, username_key)
    );
    CREATE TABLE IF NOT EXISTS scrapes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT, contest_name TEXT, total_users INTEGER, total_questions INTEGER,
      created_at TEXT, payload TEXT
    );
    CREATE TABLE IF NOT EXISTS topics (
      slug TEXT, question TEXT, topic TEXT, PRIMARY KEY(slug, question)
    );
    CREATE TABLE IF NOT EXISTS topic_videos (
      slug TEXT, topic TEXT, video_url TEXT, PRIMARY KEY(slug, topic)
    );
    CREATE TABLE IF NOT EXISTS question_categories (
      slug TEXT, question TEXT, category TEXT, PRIMARY KEY(slug, question)
    );
    CREATE TABLE IF NOT EXISTS contests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      college TEXT, name TEXT, contest_url TEXT, slug TEXT, created_at TEXT, share_token TEXT
    );
    CREATE TABLE IF NOT EXISTS contest_students (
      contest_id INTEGER, username_key TEXT, PRIMARY KEY(contest_id, username_key)
    );
  `);
  try { sql.exec('ALTER TABLE contests ADD COLUMN share_token TEXT'); } catch { /* exists */ }
  backend = 'sqlite';
} catch (err) {
  console.warn('[db] node:sqlite unavailable, using JSON files:', err.message);
  backend = 'json';
}
export const storageBackend = () => backend;

function readJson(f, fb) { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); } catch { return fb; } }
function writeJson(f, o) { fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(o, null, 2)); }
function parseVideos(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = String(v).trim();
  try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map((x) => String(x).trim()).filter(Boolean); } catch { /* not json */ }
  return s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
}

// ===================== Colleges =====================
export function listColleges() {
  if (backend === 'sqlite') {
    return sql.prepare(`
      SELECT c.id, c.name, c.contest_url AS contestUrl, c.slug,
             (c.access_code IS NOT NULL AND c.access_code <> '') AS hasCode,
             COUNT(s.id) AS students
      FROM colleges c LEFT JOIN students s ON s.college = c.name
      GROUP BY c.id ORDER BY c.name
    `).all().map((r) => ({ id: r.id, name: r.name, contestUrl: r.contestUrl || '', slug: r.slug || '', hasCode: !!r.hasCode, students: r.students }));
  }
  const cs = readJson('colleges.json', { colleges: [], seq: 0 });
  const studs = readJson('students.json', { students: [], seq: 0 }).students;
  return cs.colleges.map((c) => ({ id: c.id, name: c.name, contestUrl: c.contestUrl || '', slug: c.slug || '', hasCode: !!c.accessCode, students: studs.filter((s) => s.college === c.name).length }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export function getCollegeByName(name) {
  if (backend === 'sqlite') return sql.prepare('SELECT id, name, access_code AS accessCode, contest_url AS contestUrl, slug FROM colleges WHERE lower(name)=lower(?)').get(String(name));
  return readJson('colleges.json', { colleges: [] }).colleges.find((c) => c.name.toLowerCase() === String(name).toLowerCase());
}
export function addCollege({ name, accessCode = '', contestUrl = '', slug = '' }) {
  const nm = String(name || '').trim(); if (!nm) throw new Error('College name is required.');
  if (backend === 'sqlite') {
    sql.prepare('INSERT OR IGNORE INTO colleges(name,access_code,contest_url,slug,created_at) VALUES(?,?,?,?,?)').run(nm, accessCode, contestUrl, slug, new Date().toISOString());
    return sql.prepare('SELECT id, name FROM colleges WHERE name=?').get(nm);
  }
  const cs = readJson('colleges.json', { colleges: [], seq: 0 });
  let c = cs.colleges.find((x) => x.name.toLowerCase() === nm.toLowerCase());
  if (!c) { cs.seq++; c = { id: cs.seq, name: nm, accessCode, contestUrl, slug }; cs.colleges.push(c); writeJson('colleges.json', cs); }
  return { id: c.id, name: c.name };
}
export function updateCollege(id, fields) {
  if (backend === 'sqlite') {
    const cur = sql.prepare('SELECT id, access_code AS accessCode, contest_url AS contestUrl, slug FROM colleges WHERE id=?').get(Number(id));
    if (!cur) return null;
    const next = { accessCode: fields.accessCode !== undefined ? fields.accessCode : cur.accessCode, contestUrl: fields.contestUrl !== undefined ? fields.contestUrl : cur.contestUrl, slug: fields.slug !== undefined ? fields.slug : cur.slug };
    sql.prepare('UPDATE colleges SET access_code=?, contest_url=?, slug=? WHERE id=?').run(next.accessCode, next.contestUrl, next.slug, Number(id));
    return { id: Number(id), ...next };
  }
  const cs = readJson('colleges.json', { colleges: [] });
  const c = cs.colleges.find((x) => x.id === Number(id)); if (!c) return null;
  if (fields.accessCode !== undefined) c.accessCode = fields.accessCode;
  if (fields.contestUrl !== undefined) c.contestUrl = fields.contestUrl;
  if (fields.slug !== undefined) c.slug = fields.slug;
  writeJson('colleges.json', cs); return c;
}
export function verifyCollegeCode(name, code) {
  const c = getCollegeByName(name);
  return !!c && String(c.accessCode || '') !== '' && String(c.accessCode) === String(code);
}
export function deleteCollege(id) {
  const col = listColleges().find((c) => String(c.id) === String(id));
  const name = col?.name;
  if (name) {
    for (const ct of listContests(name)) deleteContest(ct.id);
    if (backend === 'sqlite') sql.prepare('DELETE FROM students WHERE college=?').run(name);
    else { const d = readJson('students.json', { students: [] }); d.students = d.students.filter((s) => s.college !== name); writeJson('students.json', d); }
  }
  if (backend === 'sqlite') return sql.prepare('DELETE FROM colleges WHERE id=?').run(Number(id)).changes > 0;
  const cs = readJson('colleges.json', { colleges: [], seq: 0 });
  const before = cs.colleges.length; cs.colleges = cs.colleges.filter((x) => x.id !== Number(id)); writeJson('colleges.json', cs);
  return cs.colleges.length < before;
}

// ===================== Contests =====================
export function listContests(college) {
  if (backend === 'sqlite') {
    const base = 'SELECT id, college, name, contest_url AS contestUrl, slug, share_token AS shareToken FROM contests';
    return (college ? sql.prepare(base + ' WHERE college=? ORDER BY id').all(college) : sql.prepare(base + ' ORDER BY college, id').all());
  }
  const cs = readJson('contests.json', { contests: [], seq: 0 });
  return cs.contests.filter((c) => !college || c.college === college).map((c) => ({ id: c.id, college: c.college, name: c.name, contestUrl: c.contestUrl || '', slug: c.slug || '', shareToken: c.shareToken || '' }));
}
export function getContest(id) {
  if (backend === 'sqlite') return sql.prepare('SELECT id, college, name, contest_url AS contestUrl, slug, share_token AS shareToken FROM contests WHERE id=?').get(Number(id));
  return readJson('contests.json', { contests: [] }).contests.find((c) => c.id === Number(id));
}
export function getContestByShareToken(token) {
  if (!token) return null;
  if (backend === 'sqlite') return sql.prepare('SELECT id, college, name, contest_url AS contestUrl, slug, share_token AS shareToken FROM contests WHERE share_token=?').get(String(token));
  return readJson('contests.json', { contests: [] }).contests.find((c) => c.shareToken === token);
}
export function setContestShareToken(id, token) {
  if (backend === 'sqlite') { sql.prepare('UPDATE contests SET share_token=? WHERE id=?').run(token, Number(id)); return; }
  const cs = readJson('contests.json', { contests: [] }); const c = cs.contests.find((x) => x.id === Number(id)); if (c) { c.shareToken = token; writeJson('contests.json', cs); }
}
export function addContest({ college, name, contestUrl = '', slug = '' }) {
  const col = String(college || '').trim(); const nm = String(name || '').trim();
  if (!col) throw new Error('College is required.'); if (!nm) throw new Error('Contest name is required.');
  if (backend === 'sqlite') {
    const r = sql.prepare('INSERT INTO contests(college,name,contest_url,slug,created_at) VALUES(?,?,?,?,?)').run(col, nm, contestUrl, slug, new Date().toISOString());
    return getContest(Number(r.lastInsertRowid));
  }
  const cs = readJson('contests.json', { contests: [], seq: 0 }); cs.seq++;
  const c = { id: cs.seq, college: col, name: nm, contestUrl, slug }; cs.contests.push(c); writeJson('contests.json', cs);
  return c;
}
export function updateContest(id, { name, contestUrl, slug }) {
  const cur = getContest(id); if (!cur) return null;
  const next = { name: name !== undefined ? String(name).trim() : cur.name, contestUrl: contestUrl !== undefined ? contestUrl : cur.contestUrl, slug: slug !== undefined ? slug : cur.slug };
  if (backend === 'sqlite') sql.prepare('UPDATE contests SET name=?, contest_url=?, slug=? WHERE id=?').run(next.name, next.contestUrl, next.slug, Number(id));
  else { const cs = readJson('contests.json', { contests: [] }); Object.assign(cs.contests.find((c) => c.id === Number(id)), next); writeJson('contests.json', cs); }
  return getContest(id);
}
export function deleteContest(id) {
  const ct = getContest(id); if (!ct) return false;
  const slug = ct.slug;
  if (backend === 'sqlite') {
    sql.prepare('DELETE FROM contests WHERE id=?').run(Number(id));
    sql.prepare('DELETE FROM contest_students WHERE contest_id=?').run(Number(id));
    if (slug) {
      const others = sql.prepare('SELECT COUNT(*) AS n FROM contests WHERE slug=?').get(slug).n;
      if (!others) { sql.prepare('DELETE FROM scrapes WHERE slug=?').run(slug); sql.prepare('DELETE FROM topics WHERE slug=?').run(slug); sql.prepare('DELETE FROM topic_videos WHERE slug=?').run(slug); sql.prepare('DELETE FROM question_categories WHERE slug=?').run(slug); }
    }
    return true;
  }
  const cs = readJson('contests.json', { contests: [], seq: 0 });
  cs.contests = cs.contests.filter((c) => c.id !== Number(id)); writeJson('contests.json', cs);
  const asg = readJson('assignments.json', {}); delete asg[id]; writeJson('assignments.json', asg);
  if (slug && !cs.contests.some((c) => c.slug === slug)) {
    const sc = readJson('scrapes.json', { items: [], seq: 0 }); sc.items = sc.items.filter((x) => x.slug !== slug); writeJson('scrapes.json', sc);
    const tp = readJson('topics.json', {}); delete tp[slug]; writeJson('topics.json', tp);
    const tv = readJson('topicvideos.json', {}); delete tv[slug]; writeJson('topicvideos.json', tv);
    const qc = readJson('questioncategories.json', {}); delete qc[slug]; writeJson('questioncategories.json', qc);
  }
  return true;
}

// ===================== Contest ↔ student mapping =====================
export function assignStudentsToContest(contestId, usernameKeys) {
  const keys = (usernameKeys || []).map((k) => String(k).toLowerCase()).filter(Boolean);
  if (backend === 'sqlite') {
    const ins = sql.prepare('INSERT OR IGNORE INTO contest_students(contest_id,username_key) VALUES(?,?)');
    for (const k of keys) ins.run(Number(contestId), k);
    return keys.length;
  }
  const all = readJson('assignments.json', {}); const cur = new Set(all[contestId] || []);
  for (const k of keys) cur.add(k); all[contestId] = Array.from(cur); writeJson('assignments.json', all);
  return keys.length;
}
export function getContestStudentKeys(contestId) {
  if (backend === 'sqlite') return sql.prepare('SELECT username_key AS k FROM contest_students WHERE contest_id=?').all(Number(contestId)).map((r) => r.k);
  return readJson('assignments.json', {})[contestId] || [];
}
export function listContestsForStudent(college, usernameKey) {
  const key = String(usernameKey || '').toLowerCase();
  return listContests(college).filter((c) => {
    const keys = getContestStudentKeys(c.id).map((k) => String(k).toLowerCase());
    return keys.length === 0 || keys.includes(key);
  });
}
export function listStudentsForContest(contestId) {
  const contest = getContest(contestId); if (!contest) return [];
  const all = listStudents({ college: contest.college });
  const keys = new Set(getContestStudentKeys(contestId));
  if (!keys.size) return all;
  return all.filter((s) => keys.has((s.usernameKey || '').toLowerCase()));
}

// ===================== Students =====================
function normalize(s) {
  return { id: s.id, college: s.college, name: s.name, hrUsername: s.hr_username ?? s.hrUsername, usernameKey: s.username_key ?? s.usernameKey,
    registerNo: s.register_no ?? s.registerNo, email: s.email, department: s.department, section: s.section, year: s.year, campus: s.campus };
}
export function listStudents({ college, department, section, year } = {}) {
  let rows;
  if (backend === 'sqlite') {
    const where = []; const args = [];
    for (const [k, v] of [['college', college], ['department', department], ['section', section], ['year', year]]) if (v) { where.push(`${k}=?`); args.push(v); }
    rows = sql.prepare('SELECT * FROM students' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY name').all(...args);
  } else {
    rows = readJson('students.json', { students: [] }).students.filter((s) =>
      (!college || s.college === college) && (!department || s.department === department) && (!section || s.section === section) && (!year || s.year === year));
  }
  return rows.map(normalize);
}
export function upsertStudents(college, students) {
  let n = 0;
  if (backend === 'sqlite') {
    const stmt = sql.prepare(`INSERT INTO students(college,name,hr_username,username_key,register_no,email,department,section,year,campus)
      VALUES(@c,@n,@u,@k,@r,@e,@d,@s,@y,@p)
      ON CONFLICT(college,username_key) DO UPDATE SET name=excluded.name, hr_username=excluded.hr_username,
        register_no=excluded.register_no, email=excluded.email, department=excluded.department, section=excluded.section, year=excluded.year, campus=excluded.campus`);
    for (const s of students) { if (!s.hrUsername) continue; stmt.run({ '@c': college, '@n': s.name || '', '@u': s.hrUsername, '@k': s.hrUsername.toLowerCase(), '@r': s.registerNo || '', '@e': s.email || '', '@d': s.department || '', '@s': s.section || '', '@y': s.year || '', '@p': s.campus || '' }); n++; }
    return { count: n };
  }
  const data = readJson('students.json', { students: [], seq: 0 });
  for (const s of students) {
    if (!s.hrUsername) continue;
    const key = s.hrUsername.toLowerCase();
    let ex = data.students.find((x) => x.college === college && (x.username_key || x.hr_username?.toLowerCase()) === key);
    if (!ex) { data.seq++; ex = { id: data.seq, college, username_key: key }; data.students.push(ex); }
    Object.assign(ex, { name: s.name || '', hr_username: s.hrUsername, register_no: s.registerNo || '', email: s.email || '', department: s.department || '', section: s.section || '', year: s.year || '', campus: s.campus || '' });
    n++;
  }
  writeJson('students.json', data); return { count: n };
}
export function deleteStudents(ids) {
  const set = new Set(ids.map(Number));
  if (backend === 'sqlite') { let n = 0; const stmt = sql.prepare('DELETE FROM students WHERE id=?'); for (const id of set) n += stmt.run(id).changes; return n; }
  const data = readJson('students.json', { students: [] }); const before = data.students.length;
  data.students = data.students.filter((s) => !set.has(s.id)); writeJson('students.json', data); return before - data.students.length;
}

// ===================== Scrapes =====================
export function saveScrape(slug, payload) {
  const createdAt = new Date().toISOString();
  const meta = { contestName: payload?.contest?.name || slug, totalUsers: payload?.summary?.totalUsers || 0, totalQuestions: payload?.summary?.totalQuestions || 0 };
  if (backend === 'sqlite') {
    const r = sql.prepare('INSERT INTO scrapes(slug,contest_name,total_users,total_questions,created_at,payload) VALUES(?,?,?,?,?,?)')
      .run(slug, meta.contestName, meta.totalUsers, meta.totalQuestions, createdAt, JSON.stringify(payload));
    return { id: Number(r.lastInsertRowid), createdAt };
  }
  const all = readJson('scrapes.json', { seq: 0, items: [] }); all.seq++;
  all.items.push({ id: all.seq, slug, ...meta, createdAt, payload }); writeJson('scrapes.json', all);
  return { id: all.seq, createdAt };
}
export function getLatestScrape(slug) {
  if (!slug) return null;
  if (backend === 'sqlite') { const r = sql.prepare('SELECT payload FROM scrapes WHERE slug=? ORDER BY id DESC LIMIT 1').get(slug); return r ? JSON.parse(r.payload) : null; }
  const items = readJson('scrapes.json', { items: [] }).items.filter((x) => x.slug === slug).sort((a, b) => b.id - a.id);
  return items.length ? items[0].payload : null;
}
export function getScrapeSeries(slug) {
  if (!slug) return [];
  let rows;
  if (backend === 'sqlite') rows = sql.prepare('SELECT created_at AS createdAt, payload FROM scrapes WHERE slug=? ORDER BY created_at ASC').all(slug);
  else rows = readJson('scrapes.json', { items: [] }).items.filter((x) => x.slug === slug).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).map((x) => ({ createdAt: x.createdAt, payload: JSON.stringify(x.payload) }));
  const byDay = new Map();
  for (const r of rows) {
    const day = String(r.createdAt).slice(0, 10);
    let payload; try { payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload; } catch { continue; }
    const solved = {};
    for (const u of (payload.users || [])) solved[u.username.toLowerCase()] = u.solved;
    byDay.set(day, solved);
  }
  return Array.from(byDay.entries()).map(([day, solved]) => ({ day, solved }));
}

// ===================== Topics =====================
export function getTopics(slug) {
  if (!slug) return {};
  if (backend === 'sqlite') { const m = {}; for (const r of sql.prepare('SELECT question, topic FROM topics WHERE slug=?').all(slug)) m[r.question] = r.topic; return m; }
  return readJson('topics.json', {})[slug]?.map || {};
}
export function saveTopics(slug, map) {
  const clean = {}; for (const [q, t] of Object.entries(map || {})) { const v = String(t || '').trim(); if (v) clean[q] = v; }
  if (backend === 'sqlite') {
    sql.prepare('DELETE FROM topics WHERE slug=?').run(slug);
    const ins = sql.prepare('INSERT OR REPLACE INTO topics(slug,question,topic) VALUES(?,?,?)');
    for (const [q, t] of Object.entries(clean)) ins.run(slug, q, t);
  } else { const all = readJson('topics.json', {}); all[slug] = { map: clean, updatedAt: new Date().toISOString() }; writeJson('topics.json', all); }
  return { count: Object.keys(clean).length };
}

// ===================== Topic videos =====================
export function getTopicVideos(slug) {
  if (!slug) return {};
  const m = {};
  if (backend === 'sqlite') { for (const r of sql.prepare('SELECT topic, video_url FROM topic_videos WHERE slug=?').all(slug)) m[r.topic] = parseVideos(r.video_url); return m; }
  const raw = readJson('topicvideos.json', {})[slug] || {};
  for (const [t, v] of Object.entries(raw)) m[t] = parseVideos(v);
  return m;
}
export function saveTopicVideos(slug, map) {
  const clean = {}; for (const [t, v] of Object.entries(map || {})) { const arr = parseVideos(v); if (arr.length) clean[t] = arr; }
  if (backend === 'sqlite') {
    sql.prepare('DELETE FROM topic_videos WHERE slug=?').run(slug);
    const ins = sql.prepare('INSERT OR REPLACE INTO topic_videos(slug,topic,video_url) VALUES(?,?,?)');
    for (const [t, arr] of Object.entries(clean)) ins.run(slug, t, JSON.stringify(arr));
  } else { const all = readJson('topicvideos.json', {}); all[slug] = clean; writeJson('topicvideos.json', all); }
  return { count: Object.keys(clean).length };
}

// ===================== Question categories =====================
export function getQuestionCategories(slug) {
  if (!slug) return {};
  if (backend === 'sqlite') { const m = {}; for (const r of sql.prepare('SELECT question, category FROM question_categories WHERE slug=?').all(slug)) m[r.question] = r.category; return m; }
  return readJson('questioncategories.json', {})[slug] || {};
}
export function saveQuestionCategories(slug, map) {
  const clean = {}; for (const [q, c] of Object.entries(map || {})) { const v = String(c || '').trim(); if (v) clean[q] = v; }
  if (backend === 'sqlite') {
    sql.prepare('DELETE FROM question_categories WHERE slug=?').run(slug);
    const ins = sql.prepare('INSERT OR REPLACE INTO question_categories(slug,question,category) VALUES(?,?,?)');
    for (const [q, c] of Object.entries(clean)) ins.run(slug, q, c);
  } else { const all = readJson('questioncategories.json', {}); all[slug] = clean; writeJson('questioncategories.json', all); }
  return { count: Object.keys(clean).length };
}
