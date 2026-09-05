// Read-only: report which schemas/tables exist (and row counts) on a Postgres/
// Supabase database. Use to verify the hackerrank + leetcode setup.
//
//   node check-schema.js "postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres"
//
// Password must be URL-encoded (% -> %25). Touches nothing — SELECT only.
import pg from 'pg';

const url = process.argv[2] || process.env.TARGET_DB_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!url) { console.error('Usage: node check-schema.js "<connection-string>"'); process.exit(1); }

const WANT = ['hackerrank', 'leetcode', 'public'];
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 15000 });

(async () => {
  try {
    const who = await pool.query('SELECT current_database() db, current_user usr');
    console.log(`\nConnected to ${who.rows[0].db} as ${who.rows[0].usr}\n`);

    const schemas = (await pool.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1) ORDER BY schema_name`, [WANT]
    )).rows.map((r) => r.schema_name);
    console.log('Schemas present:', schemas.join(', ') || '(none of hackerrank/leetcode/public)');

    for (const schema of ['hackerrank', 'leetcode']) {
      if (!schemas.includes(schema)) { console.log(`\n[${schema}] schema does NOT exist yet.`); continue; }
      const tables = (await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name`, [schema]
      )).rows.map((r) => r.table_name);
      console.log(`\n[${schema}] ${tables.length} table(s):`);
      if (!tables.length) { console.log('   (schema exists but has no tables)'); continue; }
      for (const t of tables) {
        let n = '?';
        try { n = (await pool.query(`SELECT count(*)::int c FROM "${schema}"."${t}"`)).rows[0].c; } catch (e) { n = 'err: ' + e.message; }
        console.log(`   ${t.padEnd(24)} ${String(n).padStart(8)} rows`);
      }
    }
    console.log('');
  } catch (e) {
    console.error('Check failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
