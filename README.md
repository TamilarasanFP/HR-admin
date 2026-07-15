# HackerRank Admin Dashboard

An admin dashboard (modeled on a LeetCode admin tool, but for **HackerRank**) that
tracks students' contest progress per college. Admins manage colleges, rosters, and
contests; students log into a separate portal with an access code to see their
practice list.

It reuses the proven HackerRank contest scraper (`lib/hackerrank.js`): admin
connects their HackerRank account, the app scrapes a college's contest leaderboard +
per-question completion, and joins it to the student roster.

## Storage: Supabase (Postgres)

All data is stored in **Supabase**. There is no local fallback — the server won't
start without a Supabase connection.

**One-time setup:**

1. Create a project at [supabase.com](https://supabase.com).
2. In the dashboard → **SQL Editor** → paste and run [`schema.sql`](./schema.sql)
   (creates the tables).
3. Get your credentials: **Project Settings → API** → copy the **Project URL** and
   the **`service_role`** key (keep this secret — it bypasses row-level security).

## Run

Requires Node 18+.

```bash
npm install
SUPABASE_URL="https://xxxx.supabase.co" \
SUPABASE_SERVICE_KEY="your-service-role-key" \
npm start            # http://localhost:4000
```

**Admin login** defaults to `admin` / `admin`. Override with `ADMIN_USER` /
`ADMIN_PASS`.

**Mock mode** still needs Supabase (only the HackerRank scrape is faked):

```bash
SUPABASE_URL=… SUPABASE_SERVICE_KEY=… MOCK=1 npm start
```

> Note: switching to Supabase starts empty — data from the old local SQLite
> (`data/app.db`) is **not** migrated automatically.

## Flow

1. **Sign in** as admin.
2. **Colleges** tab — add a college with a **student access code** (never shown; you
   can overwrite it).
3. **Upload** tab — pick the college and upload an Excel/CSV roster. Required
   columns: `Student Name`, `HackerRank Username` (or profile URL). Optional:
   `Register Number`, `Email`, `Department`, `Section`, `Year`, `Campus`. A template
   is downloadable in-app.
4. **Dashboard** tab — pick a college, then add one or more **contests** to it with
   **＋ Contest** (name + HackerRank link). A college can have **multiple contests**.
   Select a contest, **Connect HackerRank**, then **Sync now** to scrape it (live
   progress). The students table joins the roster to that contest: solved, score,
   completion. Filter by department / section / year, search, **Export to Excel**,
   delete selected, or click a name for a full performance breakdown.
5. **Topics** tab — pick a college and one of its contests, then tag each question
   with a topic (Auto-fill from titles, or type). These drive the "By topic"
   breakdowns.

## Student portal

Separate page at **/student**. A student enters their **college name + access code**,
picks their name and a **contest**, and sees two sections: a **Dashboard** (stat
cards + by-topic breakdown) and **Practice** (paginated, 10 per page, with Solve
links). They can switch contests from the dropdown at the top.

## Notes & limits

- This is the **first milestone** (foundation). Planned next: the practice-assignment
  system (Domain → Topic → Question hierarchy + completion breakdown + hardest
  questions).
- HackerRank has no public Easy/Medium/Hard profile or global rank like LeetCode, so
  stats here are **contest-based** (solved / score / completion), not a global
  profile.
- Access codes are a convenience gate, not strong security. Don't expose this server
  to the public internet without adding real auth + HTTPS.
- Data is stored locally in SQLite (`data/app.db`) via Node's built-in `node:sqlite`,
  with a JSON-file fallback. The HackerRank session (for scraping) lives in memory
  only.

## Layout

```
server.js          Express: admin auth, colleges, roster, scrape (SSE), student portal
lib/hackerrank.js  Contest scraper (login, leaderboard, per-question compare)
lib/db.js          SQLite/JSON storage: colleges, students, scrapes
lib/mock.js        Synthetic contest data for MOCK mode
public/            Admin app (index.html, app.js) + student portal (student.html)
```
