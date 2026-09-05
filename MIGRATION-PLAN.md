# Merge HackerRank + LeetCode into ONE Supabase project

**Goal:** both apps run off the single new Supabase project
(`obtuzeqstivzrcmtkzvp`), their tables isolated by Postgres schema so the
identically-named tables (`colleges`, `students`, `app_settings`) never collide.
LeetCode's existing data is migrated across.

- HackerRank app  → schema `hackerrank`   (env `DB_SCHEMA=hackerrank`)
- LeetCode app    → schema `leetcode`      (env `DB_SCHEMA=leetcode`)

Why schemas, not `hr_`/`lc_` name prefixes: prefixes would require rewriting
every SQL query in both codebases (hundreds of edits, high risk). Schemas give
the same isolation with **zero query changes** — each app just points its
search_path at its own schema. Both apps' tables still live in one database.

---

## What's already done (code)

- HackerRank `lib/db.pg.js`: added `DB_SCHEMA` support (creates + uses its schema via `search_path`).
- LeetCode `src/pgstore.js`: same `DB_SCHEMA` support added.
- `schema-combined.sql`: creates both schemas + all 17 tables/indexes in one file.
- `export-data.js` / `import-data.js`: now schema-aware (`SRC_SCHEMA` / `DST_SCHEMA`),
  FK-ordered, and preserve identity ids (OVERRIDING SYSTEM VALUE + sequence reset).

## ⚠ Must-know before running

1. **Use the DIRECT connection** (`db.<ref>.supabase.co:5432`) for BOTH apps on
   the new project. The `search_path` schema routing does NOT persist on the
   transaction pooler (port 6543); on the pooler both apps fall back to `public`
   and collide. (Session pooler is OK; transaction pooler is not.)
2. Back up first. The import is additive (`ON CONFLICT DO NOTHING`), but always
   export before touching anything.
3. Rotate the DB password afterwards — it's been shared in plaintext.

---

## Steps

### 1. Create the schemas on the new project
Supabase SQL Editor → paste `schema-combined.sql` → Run.
(Or let each app create its own schema on first boot.)

### 2. Migrate HackerRank data (old HR Supabase → new `hackerrank` schema)
```
# from hr-admin/, .env still points at the OLD HackerRank DB (public schema)
node --env-file=.env export-data.js
# → backup/public-<timestamp>/  (and backup/latest)

DST_SCHEMA=hackerrank node import-data.js backup/latest \
  "postgresql://postgres:<PW>@db.obtuzeqstivzrcmtkzvp.supabase.co:5432/postgres"
```

### 3. Migrate LeetCode data (old LeetCode Supabase → new `leetcode` schema)
```
# from "Leetcode course/", its .env points at the OLD LeetCode DB (public schema).
# Copy export-data.js / import-data.js into that folder (or run with full paths).
node --env-file=.env export-data.js
DST_SCHEMA=leetcode node import-data.js backup/latest \
  "postgresql://postgres:<PW>@db.obtuzeqstivzrcmtkzvp.supabase.co:5432/postgres"
```

### 4. Point both apps at the new project
HackerRank `.env` (and Render env):
```
SUPABASE_DB_URL=postgresql://postgres:<PW>@db.obtuzeqstivzrcmtkzvp.supabase.co:5432/postgres
DB_SCHEMA=hackerrank
```
LeetCode `.env` (and its host):
```
DB_DRIVER=supabase
SUPABASE_DB_URL=postgresql://postgres:<PW>@db.obtuzeqstivzrcmtkzvp.supabase.co:5432/postgres
DB_SCHEMA=leetcode
```

### 5. Verify
- Both apps boot; logs show `[schema: hackerrank]` / `[schema: leetcode]`.
- Row counts match the export `_manifest.json` for each app.
- Spot-check a college + its students in each app's dashboard.
- Supabase Table Editor → switch the schema dropdown to `hackerrank` / `leetcode`
  to see each set.

---

## Open decision
"colleges on both" — currently each app keeps its OWN colleges list (isolated).
A single SHARED colleges table across both apps is a much larger change (both
apps key colleges differently: HackerRank by name-text, LeetCode by id-FK).
Flag if you want that; it's a separate task.
