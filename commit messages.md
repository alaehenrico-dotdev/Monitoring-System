# Commit Messages

## Latest commit (uncommitted)

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
