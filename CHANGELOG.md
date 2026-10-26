# Changelog

## Unreleased

### Changed
- **The Glossy Black Ala Eh! emblem is now the background in every theme, and more visible.** Enterprise, Neobrutalism, Flat, Minimalism and Aurora used to hide it; they now show it like Classic, Glass and Skeuomorphism do (pale in dark mode, ink in light mode, see-through, so text stays readable). Each theme keeps its own colours and gradients behind it. It is stronger than before: 30% in light mode and 50% in dark (it was 12% and 30%), with Minimalism a little quieter (20% and 40%).

### Fixed
- **The Daily Report PDF saved to Google Drive no longer prints an "Upsell (Out)" column** on the Offline sheet. The entry pages never had it; the amount is still stored and still counts in Remaining Stocks and the outflow figures.
- **The Daily Report PDF saved to Google Drive now includes the added columns.** The Online and Offline sheets only had the fixed columns, so anything added from a column's right-click menu (extra Delivery (Out) routes, extra Fulfillment (Out) channels, ...) was missing. Each added column now sits right after the column it was added to, with the name typed for it (both names, "Morning / Night", if the shifts named it differently) or "<column> +1" when unnamed. If the names cannot be read the columns still print, under the generic labels. Days already in Drive are re-saved with them the next time that day is generated.
- **The emblem background was not loading at all** since the stylesheet was split into `src/styles/`: its two image paths still pointed at the old folder, so the build bundled neither image and every theme showed no emblem. Paths corrected, and a new test checks that every `url()` in the stylesheets points at a file that exists.

## 2.4.3 - 2026-10-26

### Fixed
- **Restoring a backup no longer breaks Google Drive.** A restore replaces every table, including the stored Drive connection, so the backup file's older, foreign or missing token used to become the live one and the next Drive call failed. This server's own connection is now kept across a restore (and put back even if the restore stops partway), and its cached access token is dropped. A server with no connection stays disconnected rather than inheriting the file's.

### Changed
- **The Daily Report PDF saved to Google Drive is now portrait** (it was landscape). The text size is chosen per table: it starts at 9 pt for narrow tables and steps down only as far as needed for the widest number in each column to fit the page, so figures never run off the edge. Reports already in Drive are re-saved once in the new layout the next time each day is generated.

### Added
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
