# Changelog

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
