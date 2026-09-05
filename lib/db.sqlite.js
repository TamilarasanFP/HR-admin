// NOTE: the original local SQLite/JSON backend was lost and could not be
// recovered (no git history, no backup copy). This app runs on Supabase, so the
// dispatcher (db.js) only imports this file when SUPABASE_DB_URL is NOT set.
// If you see the error below, set SUPABASE_DB_URL in .env to use Supabase.
throw new Error(
  'Local SQLite backend is unavailable (lib/db.sqlite.js was lost). ' +
  'Set SUPABASE_DB_URL in .env to run against Supabase/Postgres.'
);
