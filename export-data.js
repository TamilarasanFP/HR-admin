// Export every table from the configured database (Supabase/Postgres) into a
// local backup folder. Run on a machine that can reach Supabase:
//
//   node --env-file=.env export-data.js
//
// Produces:  backup/<timestamp>/<table>.json   (one file per table)
//            backup/<timestamp>/_manifest.json (row counts + metadata)
//            backup/latest -> newest export (a copy, for easy reference)
//
// Restore into another Postgres with:  node --env-file=.env import-data.js backup/<timestamp>
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env if the process wasn't started with --env-file.
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

const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!url) { console.error('No SUPABASE_DB_URL / DATABASE_URL set. Use: node --env-file=.env export-data.js'); process.exit(1); }

// Which schema to read from (source). Default 'public'.
const SCHEMA = (process.env.SRC_SCHEMA || process.env.DB_SCHEMA || 'public').replace(/[^a-zA-Z0-9_]/g, '') || 'public';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join('backup', `${SCHEMA}-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2, options: `-c search_path=${SCHEMA},public` });

(async () => {
  try {
    // Discover all base tables in the chosen schema.
    const t = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema=$1 AND table_type='BASE TABLE'
      ORDER BY table_name`, [SCHEMA]);
    const tables = t.rows.map((r) => r.table_name);
    if (!tables.length) { console.error('No tables found in public schema.'); process.exit(1); }

    const manifest = { exportedAt: new Date().toISOString(), database: url.replace(/:[^:@/]+@/, ':****@'), tables: {} };
    console.log(`\nExporting ${tables.length} table(s) → ${outDir}\n`);
    let grandTotal = 0;
    for (const name of tables) {
      const r = await pool.query(`SELECT * FROM "${SCHEMA}"."${name}"`);
      const file = path.join(outDir, `${name}.json`);
      fs.writeFileSync(file, JSON.stringify(r.rows, null, 0));
      const bytes = fs.statSync(file).size;
      manifest.tables[name] = { rows: r.rowCount, bytes };
      grandTotal += r.rowCount;
      console.log(`  ${name.padEnd(22)} ${String(r.rowCount).padStart(7)} rows   ${(bytes / 1024).toFixed(1)} KB`);
    }
    manifest.totalRows = grandTotal;
    fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2));

    // Refresh backup/latest as a plain copy of this export.
    const latest = path.join('backup', 'latest');
    fs.rmSync(latest, { recursive: true, force: true });
    fs.mkdirSync(latest, { recursive: true });
    for (const f of fs.readdirSync(outDir)) fs.copyFileSync(path.join(outDir, f), path.join(latest, f));

    console.log(`\n✅ Done. ${grandTotal} total rows across ${tables.length} tables (schema: ${SCHEMA}).`);
    console.log(`   Backup: ${outDir}  (also copied to backup/latest)`);
    console.log(`   Restore:  DST_SCHEMA=<schema> node import-data.js ${outDir} "<target-url>"\n`);
  } catch (e) {
    console.error('Export failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
