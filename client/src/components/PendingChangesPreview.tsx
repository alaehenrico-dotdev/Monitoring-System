import type { PendingChangeDetail } from "../hooks/usePendingEntryChanges";
import { colors } from "../theme";

/// The Preview modal's contents on the Online/Offline Entry pages - every
/// staged-but-unsaved edit as one row, so an encoder can check a whole
/// batch of changes over before Save actually submits them.
export function PendingChangesPreview({
  items,
  showTotal = false,
}: {
  items: PendingChangeDetail[];
  /// Adds a pinned Total row (changes count, summed old/new values) - used by
  /// the CSV Review Import dialog so a whole file can be sanity-checked at a
  /// glance before it is saved.
  showTotal?: boolean;
}) {
  const totalOld = items.reduce((sum, i) => sum + i.oldValue, 0);
  const totalNew = items.reduce((sum, i) => sum + i.newValue, 0);
  if (items.length === 0) {
    return (
      <p style={{ margin: 0, color: colors.subtleInk, fontSize: 13 }}>
        No unsaved changes.
      </p>
    );
  }

  return (
    // ae-table's <th> is position: sticky, which sticks relative to its
    // nearest *scrolling* ancestor. Without this wrapper, that ancestor was
    // .ae-modal-body - a much taller box than this table - so the header
    // detached from its own columns and rode along with the whole dialog's
    // scroll instead of the table's. ae-table-wrap gives the table its own
    // bounded scroll box (matching every other ae-table on the site), so
    // the sticky header now tracks the columns beneath it correctly, with
    // a max height so a long change list scrolls inside the dialog instead
    // of pushing the Save/Cancel buttons off-screen.
    <div
      className="ae-table-wrap"
      style={{ maxHeight: "50vh", overflowY: "auto" }}
    >
      <table className="ae-table" style={{ minWidth: 0 }}>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Category</th>
            <th>Field</th>
            <th>Old value</th>
            <th>New value</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={`${item.productId}-${item.label}-${i}`}>
              <td style={{ textAlign: "left", color: colors.ink }}>
                {item.name}
              </td>
              <td style={{ textAlign: "left", color: colors.ink }}>
                {item.category}
              </td>
              <td style={{ textAlign: "left", color: colors.ink }}>
                {item.label}
              </td>
              <td>{item.oldValue.toLocaleString()}</td>
              <td style={{ fontWeight: 700, color: colors.yellow }}>
                {item.newValue.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
        {showTotal && (
          <tfoot>
            <tr>
              <td
                colSpan={3}
                style={{
                  textAlign: "left",
                  fontWeight: 700,
                  color: colors.ink,
                  position: "sticky",
                  bottom: 0,
                  background: colors.paperAlt,
                }}
              >
                Total ({items.length} change{items.length === 1 ? "" : "s"})
              </td>
              <td
                style={{
                  fontWeight: 700,
                  position: "sticky",
                  bottom: 0,
                  background: colors.paperAlt,
                }}
              >
                {totalOld.toLocaleString()}
              </td>
              <td
                style={{
                  fontWeight: 700,
                  color: colors.yellow,
                  position: "sticky",
                  bottom: 0,
                  background: colors.paperAlt,
                }}
              >
                {totalNew.toLocaleString()}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
