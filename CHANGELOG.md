# Changelog

## Unreleased

## 2.5.0 - 2026-10-31

**Upgrading a running server:** run the normal deploy (`deploy/vps/deploy.sh`, which snapshots the database before it migrates). One migration, `20261031090000_single_encoder_role`, turns every Online and Offline Encoder into an **Encoder**. The default backup folder is now `/var/backups/alaeh-stocks` (create it once: `sudo mkdir -p /var/backups/alaeh-stocks/snapshots /var/backups/alaeh-stocks/daily && sudo chown -R $USER:$USER /var/backups/alaeh-stocks && chmod -R 700 /var/backups/alaeh-stocks`; set `BACKUP_DIR="/var/backups/alaeh-stocks/daily"` in `server/.env` for the Backups page). The PM2 process is now called `alaeh-stocks` (was `ala-eh-api`); `deploy.sh` removes the old one for you, so use `pm2 logs alaeh-stocks` from now on. No new required settings. Do not re-run `npm run seed` on a live server: it would add a new `encoder` account. Remove the accounts you do not need from the database or keep them (they all keep working as Encoders).

### Changed
- **Restoring a database no longer touches user accounts.** The server's own accounts - passwords, roles, two-step verification, active flag and sessions - are put back exactly as they were after every restore, so an older backup can never lock anyone out or bring a removed account back. Accounts that exist only in the backup are kept (old entries point at them) but deactivated. Moving data from another PC now means keeping the server's own admin sign-in.

### Added
- **Forgot password with an authenticator.** An Encoder who has two-step verification on can reset a forgotten password from the login page with a current authenticator code (or an unused recovery code) instead of waiting for an administrator. Admin accounts still need an administrator-issued code or the server command. A weak new password is now refused before any code is checked or spent, wrong authenticator codes count toward the existing per-account lockout, and every failure gives the same answer. Successful resets are logged as `password_reset_by_mfa` and sign out the account's other sessions.

### Changed
- **Two roles: Encoder and Admin.** The separate Online and Offline Encoder roles are merged into one **Encoder** (migration `20261031090000_single_encoder_role` converts existing accounts). An Encoder enters stock on both the Online and Offline grids, counts, adds and edits Awaiting Release items, and requests corrections; the Consolidated sheet is read-only for them. Approvals now belong to the Admin: **releasing** an Awaiting Release item (as well as writing it off), approving or rejecting corrections, publishing audits, closing months, reports, SKUs and settings. `npm run seed` now creates `admin` and `encoder` (`SEED_ENCODER_PASSWORD`).

### Added
- **Account security.** Everyone gets Settings > My Account:
  - **Change your own password** (needs the current one; signs out your other sessions).
  - **Two-step verification (TOTP)** with a QR code and one-time recovery codes. Optional for every role, strongly recommended for administrators. Recovery for a locked-out admin: `docker compose exec api node dist/cli/resetMfa.js <username>`.
  - **"Sign out everywhere else"** ends the account's sessions on every other device.
  - **Remember this device** on the login page: prefills the username and keeps the sign-in for `REMEMBER_DEVICE_DAYS` (default 30, max 90, 0 = off) instead of 8 hours. The password is never stored by the app. Cut off at once by a password change, "Sign out everywhere else" or deactivation.
  - **Password rules:** at least 10 characters (72 bytes at most), no common passwords, not the username, not repetitive. No forced symbols. The same rules apply to new accounts, admin resets and the recovery CLI.
  - **Every existing account must choose its own password at next sign-in** (migrations `20261030090000_account_security` and `20261030120000_force_password_change`); so must any account an admin creates or resets, or the seed creates. The server refuses every other request until they do.
  - **Stronger, non-blocking password hashing.** New passwords use scrypt (Node built-in, memory-hard, ~250 ms) on the thread pool instead of bcrypt; `bcryptjs` is pure JavaScript and held the whole server for ~280 ms per login at the cost needed to be strong. Older bcrypt hashes keep working and are upgraded the next time their owner signs in.
  - **The live-updates socket now honours revocation.** It used to check only the token signature, so a deactivated, reset or "signed out everywhere" account kept receiving updates and admin notices until its token expired (up to 30 days for a remembered device). It now checks the account on connect and every 30 seconds, and uses the account's current role.
- **VPS deployment with Nginx.** `docs/DEPLOY-VPS.md` walks through putting the app on an Ubuntu VPS (MySQL on the host, PM2 for the API, Nginx in front, Certbot HTTPS, cron backups, updates and rollbacks). It ships `deploy/nginx/ala-eh.conf` (the Nginx equivalent of the Caddyfile: client files with the same caching, `/api`, `/health` and the `/ws` WebSocket proxied, 520 MB streamed restore uploads, the same security headers) and `deploy/vps/deploy.sh`, a one-command update that pulls, builds, snapshots the database, migrates and restarts.
- **`scripts/restore.sh` restores encrypted backups.** Given a `.sql.gz.enc` file (or `--latest`, which now considers them) it decrypts into a private temporary file with the key from the environment or `server/.env`, runs the same completeness checks, and always removes the temporary file. A wrong key or a damaged file is refused before the database is touched.
- **Forgot password.** The app has no email, so an administrator issues a one-time reset code (Settings > User Passwords > Reset code, which asks for their own password first). The person opens **Forgot password?** on the login page and enters their username, the code and a new password. The code works once, expires after 30 minutes, is cancelled after 5 wrong guesses, and replaces any earlier code; only its hash is stored and it is shown to the admin once. Every failure (no such account, no code, expired, wrong) gives the same answer, guesses are rate-limited per address and per username, and a new password that breaks the rules does not use the code up. A successful reset signs out every session and does not turn off two-step verification (if the phone is lost too, see `dist/cli/resetMfa.js`). Migration `20261030140000_password_reset_code`. Reaching an email-based reset later would need an email field per account and SMTP settings.
- **Encrypted backups.** Set `BACKUP_ENCRYPTION_KEY` (`openssl rand -base64 32`) and every backup the app writes (browser download, Google Drive, `scripts/backup.sh`, the Docker pre-migration snapshot) is AES-256-GCM encrypted. Restore and the pre-restore check accept plain and encrypted files. Open a file by hand with `node server/dist/cli/backupCrypt.js decrypt < file.enc > file`. Keep a copy of the key outside the server: without it the backups cannot be opened.
- **Save always opens a review that says exactly where it is saving.** On the Online, Offline and Manual Count pages the dialog now starts with the page, the full date with weekday and the shift ("Tuesday, October 27, 2026 · Morning Shift"), then "N changes to M products", then the usual list. It adds a warning for a past day (history changes and the days after it are recalculated) or a future date, a note when you are on today's other shift, a warning naming the products that will end below zero (it still saves, but Finish Day will block until corrected or signed off), a note that a transfer is also written to the other table, and the "other shift already has entries" note. None of it blocks the Save. Rules: `client/src/utils/saveReview.ts`.
- **A past date opens on the shift that has its data.** Stepping to a past date used to keep the shift you were on, so a day entered under the other shift looked wiped. The Online and Offline pages now switch to the shift that holds the saved rows, once per date, only for past dates, never with unsaved edits staged and never over a shift you picked by hand (`client/src/hooks/useShiftWithSavedData.ts`).
- **Restoring an older backup brings it up to the current version straight away** (`prisma migrate deploy` runs after the restore). Before, the app errored on any newer column until the server restarted.

### Changed
- **Leaner build and image.** The server build no longer compiles tests into `dist/` (`tsconfig.build.json`), and the API image ships only `dist`, the Prisma schema + migrations and `package.json`, not TypeScript sources or tests. A new `npm run typecheck` (also a CI step) still checks the tests, which the build used to do implicitly. The 1.3 MB emblem master is no longer served: it moved to `client/design/` (source art, kept in git, excluded from images), so every client build is 1.2 MB smaller. Removed the unused `client/src/utils/logo.jpg`.

### Fixed
- **Restoring a damaged or tampered encrypted backup could be partly applied.** The upload was decrypted and fed to MySQL as it arrived, so damage near the end of a file was only noticed after the earlier part had already run. The upload is now decrypted and verified completely into a temporary file first, and only then restored; a bad file is refused with a clear message (400, not a generic 500) before any statement runs. The pre-restore check reports it the same way.
- **The container exited right after taking its pre-migration snapshot** on a server with no encrypted snapshots (the normal case), so the migrations never ran and the site answered 502. The housekeeping step of `server/docker/start.sh` could not fail on an empty pattern match, and now cannot stop the start.

### Changed
- **Re-auditing an earlier date now moves the days already saved after it.** Publishing counts with "use as next day's opening" used to leave every later day that was entered before the publish on its old opening. It now recalculates them: only the opening, and the remaining stock that follows, change; everything entered on those days is kept. A finished day is not rewritten - it is held in Corrections for an admin to approve - and an opening set by an import stays; the Manual Count page reports how many products had such a day. Editing an already-applied count still takes it back to unpublished, which puts later days back on the carried-forward figure until it is published again. Policy: `propagateOpeningStock` in `manualCounts.service.ts`. **Known gap:** an applied count opens the next DATE, so a MORNING count neither opens that day's Night sheet nor lets the Night's movements reach the next day; audits taken on the Night sheet or in whole-day mode are unaffected (two `it.fails` tests in `openingStock.test.ts` record it).
- **Grid columns are one flat colour in every theme.** The alternating dark/light columns, the In/Out/Delivery tints and the darker read-only columns are gone; a colour you pick from a header's right-click menu still applies. Column headers have a thin vertical separator.
- **The date, Category, Rows and Shift filters have no border or fill** (they look like plain text until hovered), including in the glassmorphism theme.
- **The loading beam now hugs the logo** (2% outside it instead of 8%), on the header seal and the loading spinner alike.
- **Comments now describe the current rules**: negative stock is saved and flagged, never rejected (`isNegativeStock`); a lost update, not a negative balance, is what the SERIALIZABLE save protects against.
- **The Glossy Black Ala Eh! emblem is now the background in every theme, and more visible.** Enterprise, Neobrutalism, Flat, Minimalism and Aurora used to hide it; they now show it like Classic, Glass and Skeuomorphism do (pale in dark mode, ink in light mode, see-through, so text stays readable). Each theme keeps its own colours and gradients behind it. It is stronger than before: 30% in light mode and 50% in dark (it was 12% and 30%), with Minimalism a little quieter (20% and 40%).

### Fixed
- **The service worker no longer breaks Google Fonts or throws "Failed to convert value to 'Response'".** It re-fetched the fonts itself, which the page's connect-src policy blocks, and returned nothing when there was no cached copy. Cross-origin requests are now left to the browser.
- **A failed Google Drive connect no longer puts internal error text in the address bar.** Only the app's own messages go in the redirect; anything else is logged on the server and shown as a generic message.
- **The Daily Report PDF saved to Google Drive no longer prints an "Upsell (Out)" column** on the Offline sheet. The entry pages never had it; the amount is still stored and still counts in Remaining Stocks and the outflow figures.
- **The Daily Report now covers the whole day when both shifts were entered.** It used to show only the Night sheet for a product, so the Morning shift's movements and added columns (for example the Delivery routes) were missing, and the Delivery column did not match Daily Out, which counts both shifts (1,257 vs 630 on one real day). The page, Excel and the Drive PDF now add the two sheets together: opening from the Morning sheet, every movement and added column summed over both, closing from the Night sheet. A day with one sheet is unchanged. It does not depend on the shifts setting. Days already finished keep their frozen copy; a day finished or refreshed from now on is frozen in this whole-day form. Checked against 95 real product-sheets: openings, movements and closings all match the stored sheets.
- **The Daily Report PDF saved to Google Drive now includes the added columns.** The Online and Offline sheets only had the fixed columns, so anything added from a column's right-click menu (extra Delivery (Out) routes, extra Fulfillment (Out) channels, ...) was missing. Each added column now sits right after the column it was added to, with the name typed for it (both names, "Morning / Night", if the shifts named it differently) or "<column> +1" when unnamed. If the names cannot be read the columns still print, under the generic labels. Days already in Drive are re-saved with them the next time that day is generated.
- **The emblem background was not loading at all** since the stylesheet was split into `src/styles/`: its two image paths still pointed at the old folder, so the build bundled neither image and every theme showed no emblem. Paths corrected, and a new test checks that every `url()` in the stylesheets points at a file that exists.

## 2.4.3 - 2026-10-26

### Fixed
- **Restoring a backup no longer breaks Google Drive.** A restore replaces every table, including the stored Drive connection, so the backup file's older, foreign or missing token used to become the live one and the next Drive call failed. This server's own connection is now kept across a restore (and put back even if the restore stops partway), and its cached access token is dropped. A server with no connection stays disconnected rather than inheriting the file's.

### Changed
- **The Daily Report PDF saved to Google Drive is now portrait** (it was landscape). The text size is chosen per table: it starts at 9 pt for narrow tables and steps down only as far as needed for the widest number in each column to fit the page, so figures never run off the edge. Reports already in Drive are re-saved once in the new layout the next time each day is generated. Rows are a little tighter top to bottom, which makes the report one page shorter (7 and 5 pages instead of 8 and 6 on real days) while staying easy to read.

### Added
- **A loading beam around the header seal.** The seal's gold arc (the same one as the loading spinner) circles it whenever the system is saving, loading or connecting. It appears only after about a quarter of a second, so instant requests never flash it, and stays a moment so it never blinks. It turns amber and slower for a slow connection (a request waiting 3 seconds or more) and while the live connection to the server is reconnecting, and a screen reader is told about those two. Idle, it is hidden and paused.
- **Round where round fits.** The dark/light toggle is a circle again (a late "every button is 4px" rule had squared it off), and so are the icon-only "..." menu and the compact "Clear filters" button. The clock becomes an oval (a pill) once the window is narrow enough for the compact toolbar (about 1800 px or less) and keeps its normal shape above that. The date arrows stay square, because they sit in a joined group.
- **Hide products with no figures / hide empty columns in the Daily Report.** Two switches, both off by default, so nothing changes until you turn them on. On the Daily Report page they are in the View menu and affect the screen, the PDF button and Excel together (the choice is remembered in that browser); a line on the page says what is not shown. For the PDF saved to Google Drive they are in Settings > Google Drive > Daily reports (admins), and the report's Summary lists what was left out. Only a product with every figure at zero, and a column that is zero for every product, is left out, so totals never change. A product that only has stock, or was counted, stays. On real days it saves 0 to 1 page, since the audit and the product lists make up most of the report.
- **Choose the day of the weekly Google Drive backup** (Settings > Google Drive > Database backup). A day picker sits next to the time picker, both on your own clock. **Saturday is the default** (2:00 AM Philippine time, just after Friday's Night shift closes); existing connections move from Sunday to Saturday when the update is applied, and can be changed back in the picker. Includes a migration (`drive_backup_weekday`, a new column with a default - no existing data is changed).

## 2.4.2 - 2026-10-26

Also includes everything that shipped as 2.4.1.

### Added
- **Font settings** (Settings > Appearance > Font). Pick the typeface - Inter (default), Atkinson Hyperlegible, IBM Plex Sans, System, Serif or Monospace - and the text size - Small, Default, Large or Extra large. Both apply at once, are remembered in this browser only, and have a Reset button. The text size scales the menus, forms, dialogs and pages; the data tables keep their own size (View > Zoom), so row and header heights never shift. The two downloadable typefaces are fetched only when chosen.

### Fixed
- **Google Drive backup:** a failed or aborted upload no longer risks an unhandled stream error after its temp file is removed (the read stream is now closed first).
- **Backup page:** after a download the button shows a check and fades back, and the progress line fades out; after a restore (success or failure) the card fades back to its locked starting state.
- **Loading indicators:** the top loading line, the backup download line, the toast border and the logo's loading beam now glow; the backup line also sweeps while a download runs so a slow one never looks stuck.
- **Sub-tabs** in Settings, Admin queue and Corrections now use the main navigation's underline, with a glow on the current tab.
- **A flickering vertical line across the header (dark mode).** The background emblem was drawn with a blend mode underneath the header's frosted glass, which Chromium renders with a hard, flickering seam. The emblem is now a plain transparent image at low opacity (two ready-made copies in `src/assets`, a pale one for dark mode and an ink one for light mode, about 220 KB each), and the 1.3 MB source PNG is no longer downloaded for offline use.
- **The Ctrl+K palette's product list now refreshes** after a product is added, renamed, reordered or switched off, and after a Data Reset (it used to keep its first copy until the page was reloaded).
- Removed unused code: nine unreferenced helpers and one unused test dependency.
- **Wide screens (22-24 inch).** The number boxes in the Online, Offline and Manual Count grids now grow with the screen (64px, 84px from 1500px wide, 100px from 2200px wide) instead of sitting small in very wide columns. On the Dashboard the panel headings no longer run into each other (a wider gap between the four panels). The background emblem is quieter behind the glass cards, in both light and dark mode.

### Security
- **Dependencies:** `body-parser` (denial of service), `ip-address` (slow parsing) and `zod` (memory exhaustion, upgraded to 4.6.7) are updated to patched releases. Still open and accepted: the Prisma CLI chain and the dev-only test/dev-server tooling, which need major upgrades (accepted for now; none of it is in the shipped images).
- **The API image no longer contains dev tooling.** It is built from a production-only install (vitest, vite, esbuild and tsx are gone), is about 12% smaller, and `prisma` is now a regular dependency because the container runs migrations at start.
- **Docker hardening:** no-new-privileges on every service, all Linux capabilities dropped for the API and web containers (Caddy keeps only the one that binds ports 80/443), and MySQL's local-file loading explicitly off. Run `docker compose up -d --build` to apply it.
- **`.dockerignore` now excludes every real env file** (`.env.production`, `.env.docker`, ...), keys, credentials and database dumps, not just `.env` and `.env.local`. `.gitignore` gained more key, credential, dump and profile patterns.
- **Login:** a ceiling on failed logins per IP across all usernames (default 50 per 15 minutes, `RATE_LIMIT_LOGIN_IP_MAX`) stops one address spraying a password at many accounts. Successful sign-ins never count.
- **Database:** the browser-error table is bounded (reports older than 90 days are deleted, at most 20,000 kept: `CLIENT_ERROR_RETENTION_DAYS`, `CLIENT_ERROR_MAX_ROWS`). The setup guide and `server/.env.example` now use a dedicated MySQL account limited to one database instead of `root`.
- **Dev server:** `npm run dev` and `vite preview` now listen on localhost only. Set `VITE_DEV_LAN=true` to open them to other devices on purpose.

### Changed
- **Internal:** the 8,780-line stylesheet is split into `client/src/styles/` (same cascade, same look); unused code and unneeded exports removed; the server's layering rules are now enforced by ESLint and `server/ARCHITECTURE.md` corrected to match the code.
- **Migration safety:** `npm run check:migrations` (also in CI and before `db:migrate:deploy`) fails on any migration that drops, renames, rewrites or deletes data, or adds a required column with no default, unless it is reviewed in `server/prisma/reviewed-migrations.json`.
- **Every button is 4px, in every theme.** Toolbar and menu-bar buttons were 6px, Glass 12px, Skeuomorphism 7px, and some were pills or circles (the theme toggle, calendar days). One rule at the end of the stylesheet now sets 4px on all buttons. Fields, cards and panels keep their own radius; the logo, the table category bars and the header collapse ribbon are not rounded.
- **The browser tab icon is now the Ala Eh! 3D logo** (`alaeh-logo-3d-poster.png`), also used as the Apple touch icon and as the 384px app icon in the manifest, replacing the old favicon and the missing 256px icon.
- **The default background is now the Glossy Black Ala Eh! emblem** (`client/public/Glossy Black Ala Eh! Emblem.png`), centered behind every page. It is blended with the page - screened on in dark mode, inverted into fine engraving lines in light mode - so the picture's black square never shows. Themes that already turn the watermark off still do.
- **The scheduled Google Drive database backup is now weekly** - every Sunday at the hour set in Settings (18:00 UTC by default, right after Sunday's Night shift closes) - instead of monthly. A missed Sunday is caught up when the server is back, a first backup is still taken as soon as Drive is connected, and the "Backup overdue" warning now allows 9 days instead of 33. Keep-the-newest still applies (14 by default is about three months of weekly copies).
- **Morning and Night shifts are on by default** (Settings > Entry Rules > Use Morning and Night shifts). A database with no saved choice now starts with two shifts a day; a choice already saved there is kept.
- **An audit used as the next day's opening is now a fresh starting record.** The next day entered opens at the counted figure, whichever shift it is, and every day after carries on from its own remaining stock until another audit is used the same way. Days that were already saved when the audit was published are no longer rewritten - they keep their figures, and the publish message says how many products had later days saved. Variance is unchanged. Edits to days before an audit still cannot move the days after it.
- **Variance is now Manual Count - System Remaining Stock** (it was System - Manual Count): a shortage reads negative and an overage positive. A migration flips the sign of every stored count; Audit History snapshots already published keep the figures they were saved with.

## 2.4.0 - 2026-10-23

### Added
- **Request unlock.** On a finished page, an encoder can send an unlock request with a reason from the banner. It waits in the Admin Queue (with its own counter) and is resolved when an admin unlocks the page. One open request per page.
- Added columns now keep their saved header names, and show on days entered by shift when shifts are switched off (each column as Morning + Night). A name still being typed is saved with Save. A finished sheet shows only the columns saved with it.
- **The Daily Report is now the main report.** It covers every entry (Online, Offline, Consolidated, Daily Out) **and the Audit** - every manual count for the date with the system figure, the count, the variance, remarks and published status. The Audit shows on the page, in Export Excel, in the PDF and as a table in the Drive PDF, which also opens with a Summary saying whether the day is live or finished.
- **Generate asks first, then saves to Google Drive.** Clicking Generate opens a confirmation; on OK the picked date's report is generated and saved to Drive as one PDF for that date. Generating the same date again replaces that file, or - when nothing has changed - leaves Drive alone and says it is already up to date.

### Changed
- **The web server is now Caddy instead of Nginx** (`deploy/caddy/Caddyfile`). It serves the client, proxies the API and WebSocket, and gets and renews the HTTPS certificate by itself: set `SITE_ADDRESS` to a domain in `.env` and nothing else is needed. The Nginx configs and `docker-compose.tls.yml` are removed.
- **Shifts are off by default** (one whole-day sheet, labelled "Daily Sheet"); an admin can switch them on in Settings. PDF header now reads "ALA EH! PRODUCT VENTURES".
- **The Daily Report goes to Google Drive as a PDF, not an Excel file** (`daily-report-YYYY-MM-DD.pdf`). It is built on the server with the same tables as the report page and is byte-for-byte the same for the same figures, so the checksum check that avoids re-uploading and duplicates works as before. Excel exports from the report page are unchanged. A day already saved as `.xlsx` in Drive is left alone; its new file is the `.pdf`.
- **Drive folders have exact names and are never duplicated.** They are now "Ala Eh Stock Monitoring - Backups", "- Reports" and "- Exports". Folders made under an older name are renamed in place (same folder, same files) at server start, hourly after that, and on connect; a folder is only created when none of that name exists, and year/month folders are created one at a time, so reports saved together cannot make two.
- The Daily Report's own Export Excel and Download PDF no longer also copy themselves to the Exports folder in Drive, so the same report is not kept twice (other exports still do).
- The report PDF is built so that the same report always produces the same file; Drive's checksum is compared before uploading, and stray duplicate copies of a day's file are tidied.

## 2.3.0

### Added
- **Daily Report files in Google Drive**: the Daily Report is saved to Drive as an Excel workbook automatically - when a day is finished or a correction re-saves it, and again with each backup for the latest two days - under "Ala Eh Stock Monitoring - Reports" / year / month, one file per day, replaced when it is regenerated.

### Changed
- **Toasts for everything saved to Google Drive.** A scheduled backup, a saved Daily Report and each export copy now show a toast (success, or an error that stays until closed). Backups and reports the server makes on its own are announced to every signed-in admin; an export copy is announced to the person who downloaded it; "Back up now" keeps answering the person who clicked it.
- The scheduled Google Drive database backup is now **monthly, on the last day of each month** (at the hour set in Settings), instead of daily. A first backup is still taken as soon as Drive is connected, "Back up now" still works any time and does not move the month-end one, and a missed month-end is caught up when the server is back. Settings shows when the next one is due. Keep-N now counts months (14 by default).

### Fixed
- Connecting Google Drive now says so straight away when the Drive permission was left unticked on Google's screen, instead of failing later with a 403.

### Removed
- The unused legacy `Toolbar` component, and two stale notes (`client/JWT_STORAGE_EVALUATION.md`, `docs/DEBUG_FINDINGS.md`); both remain in git history.

## 2.2.0

### Added
- **Weekly / Monthly Monitoring** card on the Dashboard: stock out, backloads, RTS, production and audit variance (net, absolute and products flagged) for a Monday-Sunday week or a calendar month, per product and in total, with the change against the previous period and a CSV export. Supervisor/Admin only.
- **Stock flow chart** on the Dashboard (7 / 14 / 30 days): production, Online fulfilled and Offline delivered as smooth lines on one scale, plus an "Out by channel" donut.
- **Daily Out in the Daily Report**: the report's date shows Online, Offline and Combined out on screen, in Excel and in the PDF, with a "Daily Out Only" section choice.
- **Daily Out History**: exported Daily Out reports are listed and can be downloaded again.
- **Shifts switch** (Settings > Entry Rules > "Use Morning and Night shifts"). Off, a day is one whole sheet saved under the calendar date, 4pm no longer cuts the entry and the date changes at midnight. Days already entered by shift show combined and read-only. On by default.

### Changed
- All report history pages (Daily Report, Variance Report, Audit, Daily Out) are now a plain table with a Download action, search and a "generated between" date filter.
- The pinned header and tab strip are frosted glass in every theme.

### Fixed
- A regenerated Daily Report (and the copy frozen when a day is finished) no longer depends on the shifts setting.
- The Monthly/Weekly variance no longer counts TOTAL audit counts a second time.
- Reopening a remembered or linked Morning sheet with shifts off opens the whole-day sheet.

### Removed
- The 12-month "Monthly Monitoring" chart (replaced by the Stock flow chart and the Weekly / Monthly card), the unused history-card styles and the unused gap option of the combo chart.

### Upgrading
No database migration is needed for 2.2.0. As always, `npm run db:migrate:deploy` (or the Docker start script) takes a snapshot before applying any pending migration and refuses to migrate if the snapshot fails.

## 2.0.0
See the git history.
