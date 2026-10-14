# Pull the update to another PC, then build and test it (Docker)

This is for the **update** (the work done after `5b41179 up`) on a PC that runs the
system **in Docker**. Docker builds the server and the client itself and the API
applies the database migrations when it starts, so there is no `npm run build`,
`prisma migrate` or `server\.env` to manage. For a PC with nothing installed, do
`SETUP.md` Part B first.

Commands are PowerShell, run from the project folder. Replace `<...>` with your value.

## Quick path (once `.env` exists, Step 4)

```powershell
cd <path-to>\Monitoring-System
git pull
docker compose up -d --build          # rebuilds, restarts, applies new migrations
docker compose logs api --tail 30     # should end with "API listening on ..."
```

Open http://localhost:8080 (or your `WEB_PORT`), then go through the checklist (Step 6).

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
not in Git. It lives in the Docker volume `db_data`. It changes only in these cases:

| What you do | Effect on data |
|---|---|
| `git pull` | None. |
| `docker compose up -d --build` / `docker compose restart api` | The API runs `prisma migrate deploy` as it starts: **structure** changes only, existing data is kept. |
| Restoring a backup | Replaces the data with the backup. |
| `docker compose down -v` (or deleting the `db_data` volume) | **Deletes the database.** Plain `docker compose down` keeps it. |
| Seed (`prisma/seed.ts`) on a database that already has data | Avoid it. Seed is for an empty database. |
| Data Reset (Settings) | Wipes data. Not part of this update. |

**What this update's two migrations run** (checked in the SQL):
- `20261014090000_finish_day_snapshots`: adds a column `entriesOnly` to
  `day_closures` (default `false`, so every existing closed day keeps its current
  lock), creates the new empty table `daily_report_snapshots`, and links it to `users`.
- `20261014100000_extra_column_labels`: creates the new empty table
  `extra_column_labels`.

Neither contains an `UPDATE`, `DELETE`, `DROP`, `TRUNCATE` or `INSERT`. Stock entries,
manual counts, products, users and the Change Log are not read or changed.

**Which database is affected:** the MySQL container of *this* project folder on *that*
PC (its own `db_data` volume). It does not touch the dev PC's data. Only the database
that is actually in that PC's Docker is changed.

**Older migrations:** the API applies every migration the database has not run yet. If
that database is far behind, older ones run too (for example `harden_schema`,
`ops_hardening`). The ones from Oct 10-13 contain no data-deleting statements.

A backup first is still good practice (Step 5): it takes a minute and is the only way
to undo a change to a database you care about.

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
  import (Step 6). Copy it to the other PC with a USB drive or a private folder.
- `.env` files are git-ignored and are **not** pushed. The other PC needs its own.

---

## Step 2. On the other PC: check Docker is ready

```powershell
git --version
docker --version
docker info           # must print server details; an error means Docker Desktop is not running yet - start it
docker compose version
```

Check the web port is free (8080 by default). Nothing printed means free:

```powershell
Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort, OwningProcess
```

If it is taken, set `WEB_PORT` in `.env` (Step 4) to another number, e.g. `8081`, and
use that in the browser and in `CLIENT_ORIGIN`.

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

---

## Step 4. The `.env` file (first time only)

Docker uses **one** file in the project root, made from `.env.docker.example`. It is
git-ignored, so it is not in the repository and not changed by a pull.

```powershell
Copy-Item .env.docker.example .env
```

Edit `.env`:

| Variable | What to put |
|---|---|
| `DB_PASSWORD` | a new password (the API builds its database URL from it, so there is no `DATABASE_URL` here) |
| `DB_ROOT_PASSWORD` | a different new password |
| `JWT_SECRET` | 32 or more random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DATA_RESET_PASSCODE` | a passcode you will remember (not `000000`: the server refuses it) |
| `CLIENT_ORIGIN` | exactly what you type in the browser, no trailing slash: `http://localhost:8080` |
| `WEB_PORT` | `8080`, unless it is taken |

`CLIENT_ORIGIN` must match the browser address exactly, or the page loads but every
request fails with a CORS error.

> If the project already ran in Docker on this PC, keep its existing `.env`. Changing
> `DB_PASSWORD` or `DB_ROOT_PASSWORD` after the database was created does **not**
> change the password inside the existing volume, and the API will fail to connect.

---

## Step 5. Data: start empty, or restore a backup

**Do not test on the live database.** Pick one:

**A. Fresh test database (no old data).** After the first start (see "Start it" below):
```powershell
docker compose exec api npx tsx prisma/seed.ts
```
It prints one-time passwords for `admin`, `online.encoder` and `offline.encoder`.
**Write them down: they are shown only once.**

**B. A copy of the real data.**
1. On the machine that holds the data, take a backup: **Settings -> Backup & Restore ->
   Download Backup**, or from that project folder:
   ```powershell
   docker compose exec -T db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --no-tablespaces ala_eh_stocks > /tmp/backup.sql'
   docker compose cp db:/tmp/backup.sql .\ala-eh-backup.sql
   ```
   Check the file ends with a line starting `-- Dump completed`. A file without it
   is truncated: do not use it.
2. Copy it to the test PC, start the system once (see "Start it" below), run the seed (A), sign
   in as `admin`, then **Settings -> Backup & Restore -> Restore** (enter
   `DATA_RESET_PASSCODE`, wait for "Backup file looks complete", confirm).
3. `docker compose restart api` so any newer migrations are applied, then sign in with
   your **old** accounts (the restore replaced the users).

### Start it (builds, applies migrations)

```powershell
docker compose up -d --build
docker compose ps                  # db, api, web: running / healthy
docker compose logs api --tail 30  # should end with "API listening on ..."
```

The first build takes several minutes. Look for the two new migrations in the API log
(`20261014090000_finish_day_snapshots`, `20261014100000_extra_column_labels`) the first
time it starts after this update. Existing data is not changed (see "Will my data change?").
Days finished before this update have no saved report, so they show live data until
someone finishes them again.

If the build fails, the error is in the build output: fix it, then run
the same command again (keep the error text if you need help).

---

## Step 6. Test checklist

Open http://localhost:8080 (or your `WEB_PORT`) and sign in as `admin` unless noted. Tick each one.

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
| `docker info` errors | Docker Desktop is not running. Start it, wait until it says "running", retry. |
| Page loads but every request fails (CORS) | `CLIENT_ORIGIN` in `.env` must exactly match the browser address, no trailing slash. Then `docker compose up -d` again. |
| `docker compose up` says `set DB_PASSWORD in .env` | `.env` is missing or a value is empty (Step 4). |
| API keeps restarting / "Access denied" | `DB_PASSWORD` in `.env` differs from the one the existing database volume was created with. Put the old value back, or (only if the data is disposable) `docker compose down -v` and start again. |
| API refuses to start | `JWT_SECRET` under 32 characters or a placeholder, or `DATA_RESET_PASSCODE` is `000000`. See `docker compose logs api`. |
| Port 8080 already in use | Set another `WEB_PORT` in `.env`, update `CLIENT_ORIGIN` to match, `docker compose up -d`. |
| Still the old screens after the update | The browser cached the old app. Hard refresh (Ctrl+Shift+R), or open a private window. |
| Import says "No sheet in this workbook is dated ..." | The sheet is chosen by the date in cell A1. Change the import date to one of the dates listed. |
| Migration error in `docker compose logs api` | Do not delete anything. Restore the backup from Step 5, then keep the log lines for help. |

## Useful Docker commands

```powershell
docker compose ps                       # what is running
docker compose logs api --tail 50 -f    # follow the API log (Ctrl+C to stop following)
docker compose restart api              # restart the API (applies new migrations)
docker compose down                     # stop everything, KEEPS the data
docker compose up -d --build            # start / rebuild after a pull
```

Never run `docker compose down -v` on a database you want to keep: `-v` deletes the data.

## Optional: run the checks without Docker

With Node.js installed you can also run the lint and unit tests directly (they do not
need a database):

```powershell
npm install
npm run lint        # expect 0 errors, 0 warnings
npm test            # expect all server and client tests to pass
```

## Rolling back the test PC

The migrations only add things. To return to the old version: `git checkout 5b41179`,
`docker compose up -d --build`, and restore the backup you took in Step 5. Do not drop
the new tables on a database you want to keep.
