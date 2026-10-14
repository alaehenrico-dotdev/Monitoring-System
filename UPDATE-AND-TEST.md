# Pull the update to another PC, then build and test it

This is for the **update** (the work done after `5b41179 up`) on a PC that will
build and test it. For a brand-new PC with nothing installed, do `SETUP.md`
first (Parts B and C), then come back here.

Commands are PowerShell. Replace `<...>` with your value.

---

## What is in this update

| Area | Change |
|---|---|
| Entry grids | Names typed into a "+ column" header are saved (new table `extra_column_labels`) and appear in the Change Log. "Zero all" is now "Clear all". |
| Finish day | The button glows once every product is saved in both grids, and is always clickable. Finishing saves the day's report (new table `daily_report_snapshots`), locks the entries, and lists the report in Daily Report History. Past dates show what was saved, read-only. |
| Days in order | A day cannot be entered while an earlier day (with saved entries) is unfinished. The sheet is read-only with a "Finish <date> first" banner and a button that jumps there. Applies to everyone, including admin. It only starts counting from the first day ever finished, so older history never blocks. |
| Audit (Manual Count) | Opens on the **Night** shift by default. Import reads the daily `CONSOLIDATED STOCKS.xlsx` (one sheet per date, Offline and Online side by side). An admin can add new products (no SKU) and apply the sheet's category/product order from the Review window. |
| Reports and logs | Variance History is recorded when the report is run. The change-log file is named `change-log-YYYY-MM-DD.csv`. Every saved daily report is in the Change Log; a re-saved one keeps the previous version. |
| Removed | `CursorGlow.tsx`, `ProgressiveImage.tsx`, `server/prisma/full_schema.sql`, `ExtraSaveModes.tsx`. |

**Two new database migrations** must run on the other PC:
`20261014090000_finish_day_snapshots` and `20261014100000_extra_column_labels`.

---

## Will my data change?

**Pulling does not touch any database.** `git pull` only brings code; your data is
not in Git. A database changes only in these cases:

| What you do | Effect on data |
|---|---|
| `git pull` | None. |
| `npx prisma migrate deploy` (or the Docker API starting, which runs it by itself) | Changes the **structure** only. Your existing data is kept. |
| Restoring a backup | Replaces the data in that database with the backup. |
| `npm run seed` on a database that already has data | Avoid it. Seed is for an empty database. |
| Data Reset (Settings) | Wipes data. Not part of this update. |

**What this update's two migrations run** (checked in the SQL):
- `20261014090000_finish_day_snapshots`: adds a column `entriesOnly` to
  `day_closures` (default `false`, so every existing closed day keeps its current
  lock), creates the new empty table `daily_report_snapshots`, and links it to `users`.
- `20261014100000_extra_column_labels`: creates the new empty table
  `extra_column_labels`.

Neither contains an `UPDATE`, `DELETE`, `DROP`, `TRUNCATE` or `INSERT`. Stock entries,
manual counts, products, users and the Change Log are not read or changed.

**Which database is affected:** the one in that PC's `DATABASE_URL`
(`server\.env`, or `.env` for Docker). Each PC normally has its own MySQL, so the
other PC does not change this PC's data. **Check the host in `DATABASE_URL` first**:
if it points at this PC's MySQL or a shared server, `migrate deploy` changes that
database.

**Older migrations:** `migrate deploy` applies every migration the database has not
run yet. If the other PC's database is far behind, older ones run too (for example
`harden_schema`, `ops_hardening`). The ones from Oct 10-13 contain no data-deleting
statements.

**When you need `migrate deploy` after a pull:** only if the pull brought new files
in `server/prisma/migrations`:

```powershell
git diff --name-only HEAD@{1} HEAD -- server/prisma/migrations
```

Anything printed means run it. Nothing printed means skip it. Running it with
nothing new is harmless. With Docker you never run it yourself.

A backup first is still good practice (**Settings -> Backup & Restore -> Download
Backup**): it takes a minute and is the only way to undo a change to a database
you care about.

---

## Step 1. On this PC: commit and push

Nothing from this update is committed yet. From the project folder:

```powershell
git status                      # review the list
git add -A
git status                      # make sure "10 - CONSOLIDATED STOCKS.xlsx" is NOT staged (see below)
git commit -m "Finish day snapshots, saved column names, consolidated sheet import, product sync, audit defaults"
git push
```

- **The workbook is business data.** If it shows as staged, run
  `git restore --staged "10 - CONSOLIDATED STOCKS.xlsx"`, or add the line
  `*.xlsx` to `.gitignore` first. It is not needed to build or run; only to try the
  import (Step 7). Copy it to the other PC with a USB drive or a private folder.
- `.env` files are git-ignored and are **not** pushed. The other PC needs its own.

---

## Step 2. On the other PC: tools

You need: **Git**, **Node.js 20 or newer**, and **MySQL 8** (Docker is the easiest way).

```powershell
git --version
node --version      # v20 or higher
docker --version    # only if you run MySQL or the whole system in Docker
```

Install anything missing (`winget install Git.Git OpenJS.NodeJS.LTS Docker.DockerDesktop`).
`SETUP.md` Part B has the full tool setup.

---

## Step 3. Get the update

**If the project is already cloned on that PC:**

```powershell
cd <path-to>\Monitoring-System
git status                      # must be clean; stash or commit local edits first
git pull
```

**If it is not:**

```powershell
git clone https://github.com/alaehenrico-dotdev/Monitoring-System.git
cd Monitoring-System
```

Then install packages. Run this again after every pull that changes a
`package.json`:

```powershell
npm install
```

---

## Step 4. Settings (first time only)

```powershell
Copy-Item server\.env.example server\.env
Copy-Item client\.env.example client\.env
```

Edit `server\.env`:

| Variable | Value |
|---|---|
| `DATABASE_URL` | e.g. `mysql://root:devpassword@localhost:3306/ala_eh_stocks?connection_limit=10&pool_timeout=20` |
| `JWT_SECRET` | 32 or more random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DATA_RESET_PASSCODE` | a passcode you will remember (not `000000`: the server refuses it) |
| `CLIENT_ORIGIN` | `http://localhost:5173` for development |

A throwaway MySQL in Docker, if you have none:

```powershell
docker run -d --name ala-eh-dev-db -p 3306:3306 `
  -e MYSQL_ROOT_PASSWORD=devpassword -e MYSQL_DATABASE=ala_eh_stocks mysql:8.0
```

---

## Step 5. Database

### Testing with real data: restore a backup first
Take a backup on the machine that holds the data (**Settings → Backup & Restore →
Download Backup**, or see `SETUP.md` A1). Restore it on the test PC (**Settings →
Backup & Restore → Restore**, or `SETUP.md` C4). Check the file ends with a
`-- Dump completed` line. Do not test on the live database.

### Apply the migrations
```powershell
cd server
npx prisma migrate deploy        # applies the 2 new migrations (use deploy, NOT "migrate dev")
cd ..
```

Run `npm run seed` **only on an empty database** (it prints one-time passwords,
write them down). Never on one that already has data.

Expected: the output lists `20261014090000_finish_day_snapshots` and
`20261014100000_extra_column_labels` as applied. Existing data is not changed
(see "Will my data change?" above). Days finished before this update have no
saved report, so they show live data until someone finishes them again.

---

## Step 6. Check, build, run

```powershell
npm run lint        # expect 0 errors, 0 warnings
npm test            # expect all server and client tests to pass
npm run build       # builds the server and the client
```

> **If the build stops at `prisma generate` with `EPERM ... query_engine-windows.dll.node`:**
> a dev server is still running and holds that file. Stop it (Ctrl+C in its
> terminal, or close the `npm run dev` window), then run the build again.

Run it for testing:

```powershell
npm run dev          # server on :4000, client on http://localhost:5173
```

To test the production build the way it runs for real, use Docker instead
(`SETUP.md` Part C): `docker compose up -d --build`. The API applies migrations
itself on every start.

---

## Step 7. Test checklist

Sign in as `admin` unless noted. Tick each one.

**Finish day and saved reports**
- [ ] On Online Entry, fill and **Save** every product in both grids. **Finish day** glows yellow.
- [ ] With one product missing, it does not glow but can still be clicked and warns before locking.
- [ ] With unsaved edits, clicking it shows "Save or discard your changes first".
- [ ] Finish the day. The sheet turns read-only with a lock banner, and **Generate report** is offered.
- [ ] Change to a past date: it shows what was saved, locked.
- [ ] **Daily Report History** lists the finished day, and Download works.
- [ ] **Change Log** shows the lock and a "Saved Daily Reports" entry.
- [ ] Admin Queue: unlock the day, finish it again. The Change Log entry says the previous version is kept.

**Days finished in order** (needs two days with saved entries)
- [ ] Finish a day (this also starts the rule from that date on).
- [ ] Save entries on the next day and **do not** finish it. Move to the day after: the sheet is read-only with "Finish <that day> first", and **Go to** jumps there.
- [ ] Finish the earlier day, come back: the later day is editable again.
- [ ] A day with no saved entries (a day off) in between never blocks.
- [ ] Morning and Night of the same date do not block each other.
- [ ] Admin Queue: unlocking an old day blocks later days again until it is re-finished (expected).

**Entry grids**
- [ ] Right-click a column header, add "+1", type a name, click away. Reload, or open the same sheet on another PC or browser: the name is still there.
- [ ] The name change appears in the Change Log as "Added column renamed".
- [ ] **Clear all** on a category resets its cells to 0 (Online/Offline Entry).

**Audit (Manual Count)**
- [ ] The page opens on the **Night** shift (yesterday's Night during the morning).
- [ ] **Clear all** on a category stages empty counts, and Save removes the saved ones. Nothing is saved until Save.

**Import (needs `10 - CONSOLIDATED STOCKS.xlsx`)**
- [ ] On Audit, **Import**, pick the workbook, choose a date that has a sheet (e.g. 2026-10-08) and a location. The Review window lists the products with their manual counts.
- [ ] Choose a date with no sheet (e.g. 2026-10-11): it errors and lists the sheets found.
- [ ] Switch the location (Offline / Online): the counts differ per block.
- [ ] If the product list differs from the sheet, a panel lists new products, moves and renames. Use **Same as "…"** for products that are the same under another spelling (this keeps the SKU), then **Add new products and apply the order of the sheet** and confirm. The file is read again and the new rows match.
- [ ] New products have no SKU (a dash). Check **SKUs**: order matches the sheet.
- [ ] Signed in as an encoder, the panel only reads "Only a Supervisor/Admin can change the product list".

**Reports and logs**
- [ ] Run a **Variance Report**: a Variance History entry appears even for a date with no variances.
- [ ] Change Log **Download** gives `change-log-YYYY-MM-DD.csv`.
- [ ] **SKUs** page refreshes by itself when another user changes the product list.

---

## Going live from the Excel sheets (the starting point)

Only the **latest** sheet is needed. Its manual counts become the opening stock.

1. Sign in as admin. On **Audit**, choose the date of the latest sheet (e.g. the last
   day the Excel was kept) and the **Night** shift, then **Import** the workbook.
2. If the Review window says the product list differs, use **Add new products and
   apply the order of the sheet** (new products get no SKU; use **Same as "..."**
   for a product that is already in the system under another spelling).
3. **Check the red/amber notice about blank counts.** A blank count in the sheet is
   saved as 0, which would start that product at zero stock. Fix or accept those rows
   before saving.
4. **Save**, then switch **Location** (Offline / Online) and import the same file again.
5. **Publish** the counts (supervisor step), for both locations. Only a published count
   carries forward, and it becomes the opening stock of the **next day's Morning** shift.
6. Start entering from the **day after** the sheet's date. Entering on the same day
   as the counts will not pick them up.

The first count of a product at a location is its opening balance (variance 0).
Do not import the older sheets: with no entries behind them they would show false
variances. Finish day starts the "days in order" rule from the first day you
finish, so nothing earlier ever blocks you.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Page loads but every request fails (CORS) | `CLIENT_ORIGIN` in `server\.env` must exactly match the address in the browser, no trailing slash. Restart the server. |
| `EPERM ... query_engine-windows.dll.node` | A running dev server holds the file. Stop `npm run dev`, then retry. |
| `prisma migrate deploy` says the database is not empty / drift | You used `migrate dev`, or the database came from a very old copy. Restore a recent backup into an empty database, then run `migrate deploy`. |
| Server refuses to start | `JWT_SECRET` under 32 characters or a placeholder, or `DATA_RESET_PASSCODE` is `000000`. |
| Tests fail only on `xlsx.test.ts` | They need no workbook (those cases skip if it is missing). If you copied the file, keep its exact name in the project root. |
| Import says "No sheet in this workbook is dated …" | The sheet is chosen by the date in cell A1. Change the import date to one of the dates listed. |
| `npm install` errors after a pull | Delete `node_modules` and run `npm install` again. |

## Rolling back the test PC

The migrations only add things. To return to the old version, check out the old
commit (`git checkout 5b41179`), run `npm install`, and restore the backup you
took in Step 5. Do not drop the new tables on a database you want to keep.
