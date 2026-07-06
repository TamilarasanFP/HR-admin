// One-time migration: local SQLite (data/app.db) -> Supabase.
// Run:  npm run migrate          (loads .env)
//   or: DRY_RUN=1 npm run migrate   (reads + counts only, no writes)
//
// Safe to run more than once: colleges/students/topics/etc. upsert; contests and
// scrapes are inserted fresh, so re-running duplicates those two — only run once.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DRY = process.env.DRY_RUN === '1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'data', 'app.db');

if (!fs.existsSync(dbPath)) { console.error(`No SQLite DB found at ${dbPath}. Nothing to migrate.`); process.exit(1); }
const old = new DatabaseSync(dbPath);
function read(table) { try { return old.prepare(`SELECT * FROM ${table}`).all(); } catch (e) { console.warn(`  (skip ${table}: ${e.message})`); return []; } }

let sb = null;
if (!DRY) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
    || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) { console.error('Missing Supabase URL/key. Set them (or run with DRY_RUN=1).'); process.exit(1); }
  const { createClient } = await import('@supabase/supabase-js');
  sb = createClient(url, key, { auth: { persistSession: false } });
}
function chk(res, label) { if (res.error) { console.error(`  ! ${label}: ${res.error.message}`); throw res.error; } return res.data; }
async function upsert(table, rows, onConflict) { if (!rows.length) return; if (DRY) return; for (let i = 0; i < rows.length; i += 500) chk(await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict }), table); }
async function insert(table, rows) { if (!rows.length) return; if (DRY) return; for (let i = 0; i < rows.length; i += 200) chk(await sb.from(table).insert(rows.slice(i, i + 200)), table); }

console.log(DRY ? '=== DRY RUN (no writes) ===' : '=== Migrating to Supabase ===');

// Colleges
const colleges = read('colleges').map((c) => ({ name: c.name, access_code: c.access_code || '', contest_url: c.contest_url || '', slug: c.slug || '' }));
await upsert('colleges', colleges, 'name');
console.log(`colleges: ${colleges.length}`);

// Contests (fresh insert, remap old id -> new id for contest_students)
const contestsRaw = read('contests');
const idMap = {};
for (const c of contestsRaw) {
  const rec = { college: c.college, name: c.name, contest_url: c.contest_url || '', slug: c.slug || '', share_token: c.share_token || null };
  if (DRY) { idMap[c.id] = c.id; continue; }
  const d = chk(await sb.from('contests').insert(rec).select('id'), 'contest');
  idMap[c.id] = d[0].id;
}
console.log(`contests: ${contestsRaw.length}`);

// Contest ↔ student mapping (remapped ids)
const cs = read('contest_students').map((r) => ({ contest_id: idMap[r.contest_id], username_key: r.username_key })).filter((r) => r.contest_id != null);
await upsert('contest_students', cs, 'contest_id,username_key');
console.log(`contest_students: ${cs.length}`);

// Students
const students = read('students').map((s) => ({ college: s.college, name: s.name || '', hr_username: s.hr_username || '', username_key: s.username_key || '', register_no: s.register_no || '', email: s.email || '', department: s.department || '', section: s.section || '', year: s.year || '', campus: s.campus || '' })).filter((s) => s.username_key);
await upsert('students', students, 'college,username_key');
console.log(`students: ${students.length}`);

// Scrapes (payload text -> jsonb)
const scrapes = read('scrapes').map((s) => { let payload = s.payload; try { payload = JSON.parse(s.payload); } catch { /* keep */ } return { slug: s.slug, contest_name: s.contest_name, total_users: s.total_users, total_questions: s.total_questions, created_at: s.created_at, payload }; });
await insert('scrapes', scrapes);
console.log(`scrapes: ${scrapes.length}`);

// Topics / videos / categories
const topics = read('topics').map((t) => ({ slug: t.slug, question: t.question, topic: t.topic }));
await upsert('topics', topics, 'slug,question');
console.log(`topics: ${topics.length}`);

const tv = read('topic_videos').map((t) => ({ slug: t.slug, topic: t.topic, video_url: t.video_url }));
await upsert('topic_videos', tv, 'slug,topic');
console.log(`topic_videos: ${tv.length}`);

const qc = read('question_categories').map((q) => ({ slug: q.slug, question: q.question, category: q.category }));
await upsert('question_categories', qc, 'slug,question');
console.log(`question_categories: ${qc.length}`);

console.log(DRY ? '=== DRY RUN complete (nothing written) ===' : '=== Migration complete ===');
