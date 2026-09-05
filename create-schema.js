// Create the full schema on a target Postgres/Supabase DB from schema.sql.
// Pass the connection string as an arg (or set TARGET_DB_URL / SUPABASE_DB_URL):
//
//   node create-schema.js "postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres"
//
// The password must be URL-encoded (e.g. % -> %25). Idempotent — safe to re-run.
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] || process.env.TARGET_DB_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!url) { console.error('Provide a connection string:  node create-schema.js "<url>"'); process.exit(1); }

const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
(async () => {
  try {
    await pool.query(sql);
    const t = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`);
    console.log('\n✅ Schema created. Tables now present:');
    for (const r of t.rows) console.log('   •', r.table_name);
    console.log('');
  } catch (e) {
    console.error('Failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
