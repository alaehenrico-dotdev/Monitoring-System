# Commit Messages

## Latest commit (uncommitted)

Document the new Settings/Database Backup, loading system, and security work in the README

- Documented the three env vars that now have no insecure fallback
  (`JWT_SECRET`, `DATA_RESET_PASSCODE`, `RECEIPT_QR_SECRET`) and how to
  generate one, plus `npm run test` / `npm run lint`
- Added the Settings page (Database Backup, Data Reset), Dashboard +
  Monthly Monitoring, a **Security** section (helmet, CSP, rate limiting,
  zod validation, error boundary), and the loading-system/code-splitting
  work under "Under the hood" - none of it was in the README before
- Fixed a stale line that still described PDF export as going through the
  browser's print dialog - that was replaced by a real generated PDF
  before any of this

## Previous commit (`35bff42`)

Add Database Backup/Settings, a resilient loading system, security
hardening, and separate Online/Offline reporting

*(Note: the auto-generated git message on this commit was garbled -
truncated mid-sentence, reading a stray planning fragment as the message
instead of a real summary. This entry is the accurate one.)*

- Settings page (Supervisor-Admin): a tabbed Database Backup panel
  alongside the existing Data Reset panel - streams a real `mysqldump`
  straight to a browser download with a live byte counter, since the
  dump's total size isn't known ahead of time
- Loading system: `Skeleton`/`Spinner`/`ProgressiveImage`/`TopProgressBar`
  components and a determinate top-of-viewport progress bar (bound to real
  progress - rows imported, bytes downloaded - where that data exists, an
  eased "still working" fallback where it doesn't), replacing bare
  "Loading…" text across every data-dependent page; a top-level React
  `ErrorBoundary` so an uncaught render error doesn't white-screen the app
- Security: `helmet` headers on every API response; a strict CSP injected
  into the client's production build only; rate limiting (a generous
  backstop across the whole API, plus a tight brute-force limit on login
  and the Data Reset passcode check); zod validation added to the
  controllers that were missing it; `JWT_SECRET`/`DATA_RESET_PASSCODE`/
  `RECEIPT_QR_SECRET` are now required with no insecure fallback; the
  printed receipt's QR code now encodes an AES-256-GCM-encrypted token
  instead of the plain receipt id
- Negative-stock guard: a Stock Out (Fulfillment/Delivery, or a transfer
  to the other channel) can no longer take a channel's Remaining Stock
  below zero - checked on both sides of an Online↔Offline transfer, not
  just the side it was entered on
- Dashboard + Monthly Monitoring: new dashboard section with a
  year-at-a-glance chart; Online and Offline are now reported separately
  everywhere (Dashboard stat cards, Monthly Monitoring bars) instead of
  only as one combined total
- Route-level code-splitting plus dynamically-imported PDF/QR libraries -
  cut the client's main bundle from ~918KB to ~333KB
- ESLint (one shared flat config for both workspaces) + Vitest set up from
  scratch, with unit tests for the stock math formulas, shift/date
  boundary logic, and the receipt QR cipher

## Previous commit (`238396b`)

Add shift filtering to stock endpoints and sku to products

- Online/Offline stock, Manual Counts, and the Variance Report now accept
  a shift filter
- Products can be created/updated with an optional `sku` field

## Previous commit (`e3fd7bf`)

Add real PDF export, an unsaved-changes guard, and a custom date picker

*(Note: the auto-generated git message on this commit was garbled - it
named a few files then said "21 more files truncated." This entry is the
accurate one.)*

- Real generated PDF export (`utils/tablePdf.ts` + `utils/pdfTables.ts`)
  on every grid page and the Variance/Daily Report, replacing
  `window.print()`
- PDF export now confirms first if there are unsaved edits
  (`utils/unsavedWork.ts`)
- Custom `DatePicker` component; `AlertDialog`/`ConfirmDialog` extracted
  as reusable components
- `listProducts` gains an `includeInactive` option

## Previous commit (`d3eed1c`)

Add a cursor-glow hover effect, rework the toolbar, and clean up a stray
backup copy of the client

*(Note: the auto-generated git message on this commit was garbled - same
issue as e3fd7bf. This entry is the accurate one.)*

- `CursorGlow.tsx`: a pointer-following glow effect, reused across
  `BackToTop`, `LiveClock`, and the row-highlight sweep
- Toolbar substantially reworked (~400 line diff)
- Removed `client.zip` and the duplicate `client1/` tree that the previous
  commit (`2a1f361`, below) had accidentally added - a ~9,400-line full
  snapshot of the client directory, not real work
- `jspdf`/`qrcode`/`qrcode.react` added as dependencies, plus receipt PDF
  generation (`utils/receiptPdf.ts`)

## Previous commit (`2a1f361`)

Add the passcode-gated Data Reset page

*(Note: the auto-generated git message on this commit was garbled - it
described only the motion-package upgrade and missed everything else,
including a large accidental addition. This entry is the accurate one.)*

- `DataResetPage` plus the server-side passcode verify/reset endpoints
  (Section: Admin) - an irreversible full-data wipe gated behind a
  separate passcode, not just a role check
- Upgraded `framer-motion` → `motion`; `RowGlowScroll` extracted as its
  own component
- **Also added `client.zip` and a full duplicate `client1/` directory**
  (~9,400 lines) - looks like an automated backup snapshot swept in by
  mistake rather than deliberate work. Cleaned up two commits later, in
  `d3eed1c` above.

## Previous commit (`972379a`)

Add dashboard analytics, site-wide dark mode, and rename Products to SKUs

- Dashboard rebuilt: stat cards (active SKUs, remaining stock, receipts
  today, variance flags), a "Today" action list surfacing what needs
  attention, and a live Recent Activity feed off the change log
- Add site-wide light/dark theme (ThemeContext/ThemeToggle) in a new
  persistent TopBar alongside a live clock; choice persists via
  localStorage and follows the OS preference on first load
- Sidebar redesign: narrower rail, a pin-open toggle (persisted),
  animated gradient border while expanded, circular tab badges, and
  restyled hover/active states
- Add a BackToTop floating button for long scrollable pages
- Add a CategoryFilter dropdown to Online/Offline Entry and Manual Count
  toolbars alongside search
- CSV import now also accepts "SKU"/"SKUs" as header aliases for
  Product/Products
- Manual Count: batch Save with a confirm modal listing every pending
  count change, instead of saving on blur; PDF disabled while a count is
  unsaved
- Rename "Product" to "SKU" throughout the UI - labels, table headers,
  placeholders, and error messages
- theme.ts: move light/dark-flippable tokens onto CSS custom properties,
  add fixed "static" ink colors for content that must stay readable on
  the permanently-white receipt paper

## Previous commit (`3aa8717`)

Add report history pages and dashboard shortcuts

- Daily and Variance Report History pages, with a table listing
  previously generated reports
- `utils/reportHistory.ts` to record/read that history (localStorage)
- A dashboard page for quick access to key metrics and shortcuts
- Improved error handling/validation for product IDs in server
  controllers
- Refactored print functionality so unsaved changes are handled correctly
  first

## Previous commit (`15983e5`)

Add Save/Preview/Undo to data entry, fix CSV import against real reports, redesign Recent Receipts

- Online/Offline Entry: cell edits now stage locally instead of saving on
  blur - Preview shows every pending change (old value -> new) before
  Save submits the batch, and Undo reverts the most recent Save (itself
  recorded in the Change Log, not a silent rewrite)
- PDF export on those pages now confirms first if there are unsaved
  changes (Save & Print / Print anyway / Cancel)
- CSV import rewritten against the business's actual monthly reports:
  handles a header row that isn't row 1, "Products" (plural), the
  report's own shorthand/typo'd column names, section-header rows with no
  Category column (including ones with stray subtotal figures on them),
  and case/punctuation-insensitive product & category matching; Stocks
  (Opening) is now importable to seed a real starting balance; a failed
  import now names a few unmatched rows instead of just a count
  Replaced the placeholder product/category seed list with the real
  names/categories from those reports
- Sidebar: collapsing to the logo icon now reclaims the full width
  instead of reserving space for it - the page heading shifts beside the
  icon rather than losing the room
- Recent Receipts redesigned as a plain sortable log table (was a card
  grid grouped by day) - click a row to preview and print it, scoped so
  only the receipt itself prints, not the page underneath
- Sales Rep on Receipts changed from a dropdown of system users to free
  text (new `salesRepName` column) - it isn't necessarily someone with a
  login
- Fixed: receipts endpoint was leaking password hashes via salesRep/
  createdBy; several pages could get stuck silently on "Loading…" forever
  if their initial fetch failed; Recent Receipts could render every row
  into an effectively invisible 0-height scroll container depending on
  the entry form's height above it

## Previous commit (`c71026c`)

Redesign sidebar and toolbar, group receipts/log by day

- Remove the PDF/print export from the receipt preview, including the
  single-receipt print-portal plumbing in index.html
- Group Recent Receipts and the Change Log by day instead of one flat list
- Sidebar can be tucked away by clicking the logo and brought back the
  same way, instead of always taking up its full width
- Restyle toolbar controls (inputs, buttons, zoom/CSV segment group) with a
  lighter, fully-rounded look closer to Google Sheets, and match category
  row names to the brand's yellow accent
- Toolbar action buttons (Export/PDF/Import) fall back to icon-only only
  once there's actually not enough room for labels, measured directly
  rather than guessed at a fixed breakpoint

## Previous commit (`26a13d5`)

Add toolbar tools, receipts redesign, and change log

- Add Excel-style zoom, CSV import/export, and PDF export to the grid pages
- Add smart search to every toolbar
- Redesign Receipts as an editable form with a live preview
- Add a Change Log page for audit history
- Fix print/export clipping and redundant Online↔Offline mirror writes
- Update README
