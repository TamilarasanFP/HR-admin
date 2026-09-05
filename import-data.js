// Restore a local backup (from export-data.js) into a TARGET Postgres database.
// The app creates the schema on boot, so run the app once against the target DB
// first (so tables exist), OR this script relies on tables already existing.
//
//   node --env-file=<target.env> import-data.js backup/latest
//
// Inserts every row with ON CONFLICT DO NOTHING, so it's safe to re-run and
// won't clobber rows that already exist. Use a FRESH target DB for a clean copy.
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

(function loadEnv() {
  try {
    const p = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
    if (!fs.existsSync(p)) return;
    for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
      const l = raw.trim(); if (!l || l.startsWith('#')) continue;
      const i = l.indexOf('='); if (i < 0) continue;
      const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  } catch { /* ignore */ }
})();

const dir = process.argv[2] || 'backup/latest';
// Target DB: 3rd CLI arg wins, else TARGET_DB_URL / SUPABASE_DB_URL / DATABASE_URL.
const url = process.argv[3] || process.env.TARGET_DB_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!url) { console.error('Set TARGET_DB_URL (or SUPABASE_DB_URL) for the destination DB.'); process.exit(1); }
if (!fs.existsSync(dir)) { console.error('Backup folder not found:', dir); process.exit(1); }

// Target schema (namespace) to write into. Default 'public'.
const SCHEMA = (process.env.DST_SCHEMA || process.env.DB_SCHEMA || 'public').replace(/[^a-zA-Z0-9_]/g, '') || 'public';

// Insert parents before children so foreign keys resolve. Covers both apps'
// tables; unknown tables get appended after. HackerRank has no FKs; LeetCode does.
const ORDER = [
  // HackerRank
  'colleges', 'contests', 'students', 'contest_students', 'scrapes', 'topics', 'topic_videos', 'question_categories', 'app_settings',
  // LeetCode (colleges → students → problems → dependents)
  'practice_problems', 'monthly_activity', 'stat_snapshots', 'practice_completions', 'practice_order',
];

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2, options: `-c search_path=${SCHEMA},public` });

(async () => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== '_manifest.json');
  const tables = [...new Set([...ORDER, ...files.map((f) => f.replace(/\.json$/, ''))])].filter((t) => files.includes(t + '.json'));
  console.log(`\nRestoring into ${url.replace(/:[^:@/]+@/, ':****@')} (schema: ${SCHEMA}) from ${dir}\n`);
  try {
    if (SCHEMA !== 'public') await pool.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    for (const name of tables) {
      const rows = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
      if (!rows.length) { console.log(`  ${name.padEnd(22)} 0 rows (skip)`); continue; }
      const cols = Object.keys(rows[0]);
      // GENERATED ALWAYS identity columns reject explicit values unless we say
      // OVERRIDING SYSTEM VALUE. We must keep original ids so FKs still line up.
      const idc = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND is_identity='YES' AND identity_generation='ALWAYS' LIMIT 1`,
        [SCHEMA, name]);
      const overriding = idc.rowCount ? 'OVERRIDING SYSTEM VALUE ' : '';
      let inserted = 0;
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const batch = rows.slice(i, i + CHUNK);
        const vals = []; const groups = [];
        batch.forEach((row, r) => {
          groups.push('(' + cols.map((_, c) => '$' + (r * cols.length + c + 1)).join(',') + ')');
          for (const c of cols) { const v = row[c]; vals.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v); }
        });
        const res = await pool.query(
          `INSERT INTO "${name}" (${cols.map((c) => `"${c}"`).join(',')}) ${overriding}VALUES ${groups.join(',')} ON CONFLICT DO NOTHING`, vals);
        inserted += res.rowCount;
      }
      // Advance the identity sequence past the max id we inserted, so new rows
      // created by the app afterward don't collide with migrated ids.
      if (overriding && cols.includes('id')) {
        await pool.query(
          `SELECT setval(pg_get_serial_sequence($1, 'id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM "${name}"), 1))`,
          [`${SCHEMA}.${name}`]).catch(() => {});
      }
      console.log(`  ${name.padEnd(22)} ${String(inserted).padStart(7)} inserted / ${rows.length} in backup`);
    }
    console.log('\n✅ Restore complete.\n');
  } catch (e) {
    console.error('Import failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
