import { useEffect, useState, type CSSProperties } from "react";
import { getManualCountGrid, saveManualCount } from "../api/manualCounts";
import type { ManualCountGridRow, StockLocation } from "../types";
import { Field, Select, TextInput } from "../components/ui";
import { colors } from "../theme";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const LOCATIONS: StockLocation[] = ["ONLINE", "OFFLINE", "TOTAL"];

/// Section 4.4 - the supervisor (or encoder on duty) enters the physical
/// count; Variance = System Remaining Stock - Manual Count is always
/// system-calculated, never typed directly.
export function ManualCountPage() {
  const [date, setDate] = useState(today());
  const [location, setLocation] = useState<StockLocation>("ONLINE");
  const [rows, setRows] = useState<ManualCountGridRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  function load() {
    setRows(null);
    getManualCountGrid(date, location)
      .then(setRows)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [date, location]);

  async function commit(productId: number) {
    const draft = drafts[productId];
    if (draft === undefined || draft === "") return;
    setError(null);
    try {
      const saved = await saveManualCount(productId, date, location, Number(draft));
      setDrafts((d) => {
        const next = { ...d };
        delete next[productId];
        return next;
      });
      // Merge the recalculated row (system remaining stock + variance) in
      // directly instead of re-fetching the whole grid for one edit.
      setRows((prev) =>
        prev?.map((r) => (r.product.id === productId ? { ...r, entry: saved, isSaved: true, isFlagged: Number(saved.variance) !== 0 } : r)) ??
        prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  const flaggedCount = rows?.filter((r) => r.isFlagged).length ?? 0;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Manual Counting &amp; Variance</h2>
      <div style={{ marginBottom: 16, display: "flex", gap: 16, alignItems: "flex-end" }}>
        <Field label="Date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Location">
          <Select value={location} onChange={(e) => setLocation(e.target.value as StockLocation)}>
            {LOCATIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        {flaggedCount > 0 && (
          <span style={{ color: colors.warningText, fontSize: 13, fontWeight: 600 }}>
            ⚠ {flaggedCount} product(s) with a non-zero variance
          </span>
        )}
      </div>
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {!rows ? (
        <p>Loading…</p>
      ) : (
        <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
          <thead>
            <tr>
              {["Category", "Product", "System Remaining", "Manual Count", "Variance"].map((h) => (
                <th
                  key={h}
                  style={{ textAlign: "right", padding: "5px 6px", borderBottom: `2px solid ${colors.black}`, background: colors.border, whiteSpace: "nowrap" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.product.id} style={r.isFlagged ? { background: colors.warningBg } : undefined}>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{r.product.category}</td>
                <td style={nameCellStyle}>{r.product.name}</td>
                {/* Prisma Decimal fields serialize as JSON strings once a row is
                    persisted (unlike the plain-number preview shown before a
                    row is saved), so this is wrapped in Number() rather than
                    relying on .toLocaleString() alone - a bare string's
                    .toLocaleString() is a silent no-op, not a crash, but it
                    would drop thousands-separator formatting on saved rows. */}
                <td style={tdStyle}>{Number(r.entry.systemRemainingStock).toLocaleString()}</td>
                <td style={tdStyle}>
                  <input
                    className="ae-input ae-input-cell"
                    type="number"
                    value={drafts[r.product.id] ?? r.entry.manualCount ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [r.product.id]: e.target.value }))}
                    onBlur={() => commit(r.product.id)}
                    onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
                    style={{ width: 64, textAlign: "right" }}
                  />
                </td>
                <td style={{ ...tdStyle, fontWeight: r.isFlagged ? 700 : 400 }}>{r.entry.variance ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const tdStyle: CSSProperties = { textAlign: "right", padding: "3px 6px", borderBottom: `1px solid ${colors.border}` };
const nameCellStyle: CSSProperties = { ...tdStyle, textAlign: "left", whiteSpace: "nowrap" };
