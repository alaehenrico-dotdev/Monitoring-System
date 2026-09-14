import type { PendingChangeDetail } from "../hooks/usePendingEntryChanges";
import { colors } from "../theme";

/// The Preview modal's contents on the Online/Offline Entry pages - every
/// staged-but-unsaved edit as one row, so an encoder can check a whole
/// batch of changes over before Save actually submits them.
export function PendingChangesPreview({ items }: { items: PendingChangeDetail[] }) {
  if (items.length === 0) {
    return <p style={{ margin: 0, color: colors.subtleInk, fontSize: 13 }}>No unsaved changes.</p>;
  }

  return (
    <table className="ae-table" style={{ minWidth: 0 }}>
      <thead>
        <tr>
          <th>Product</th>
          <th>Category</th>
          <th>Field</th>
          <th>Old value</th>
          <th>New value</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={`${item.productId}-${item.label}-${i}`}>
            <td style={{ textAlign: "left" }}>{item.name}</td>
            <td style={{ textAlign: "left" }}>{item.category}</td>
            <td style={{ textAlign: "left" }}>{item.label}</td>
            <td>{item.oldValue.toLocaleString()}</td>
            <td style={{ fontWeight: 700, color: colors.red }}>{item.newValue.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
