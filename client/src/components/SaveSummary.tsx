import type { SaveDateGate } from "../hooks/useSaveDateGate";
import type { Shift } from "../types";
import { colors } from "../theme";
import { formatDateLong } from "../utils/dateFormat";
import type { SaveNotice } from "../utils/saveReview";
import { shiftWithWord } from "../utils/shift";

/// The top of every Save review dialog: exactly which sheet is about to be written
/// to - page, full date with weekday, shift - how much is changing, and anything
/// worth a second look first (see utils/saveReview.ts). Saving into the wrong
/// date is the mistake the dialog is there to catch, so it comes before the list.
export function SaveSummary({
  page,
  date,
  shift,
  changes,
  products,
  notices,
  gate,
  onChangeDate,
}: {
  page: string;
  date: string;
  shift: Shift;
  changes: number;
  products: number;
  notices: SaveNotice[];
  /// When the date isn't today (useSaveDateGate), the tick that unlocks Save.
  gate?: SaveDateGate;
  /// Closes the dialog and opens the date picker. Unsaved changes stay with THIS date.
  onChangeDate?: () => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        role="group"
        aria-label="What you are saving"
        style={{
          padding: "10px 12px",
          border: `1px solid ${colors.border}`,
          borderRadius: 4,
          background: colors.paperAlt,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "calc(12px * var(--ae-fs, 1))", color: colors.subtleInk, textTransform: "uppercase", letterSpacing: "0.04em" }}>{page}</div>
            <div style={{ fontSize: "calc(16px * var(--ae-fs, 1))", fontWeight: 700, color: colors.ink, margin: "2px 0" }}>
              {formatDateLong(date)} · {shiftWithWord(shift)}
            </div>
            <div style={{ fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.subtleInk }}>
              {changes} change{changes === 1 ? "" : "s"} to {products} product{products === 1 ? "" : "s"}
            </div>
          </div>
          {onChangeDate && (
            <button
              type="button"
              className="ae-change-date-btn"
              onClick={onChangeDate}
              title="Close this and pick another date. Unsaved changes stay with this date."
            >
              Change date
            </button>
          )}
        </div>
      </div>
      {notices.map((n, i) => (
        <p
          key={i}
          role={n.tone === "warn" ? "alert" : "status"}
          style={{
            margin: "8px 0 0",
            padding: "8px 10px",
            borderRadius: 4,
            fontSize: "calc(12.5px * var(--ae-fs, 1))",
            background: n.tone === "warn" ? colors.warningBg : colors.paperAlt,
            color: n.tone === "warn" ? colors.warningText : colors.ink,
          }}
        >
          <strong>{n.tone === "warn" ? "Check: " : "Note: "}</strong>
          {n.text}
        </p>
      ))}
      {gate?.needed && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "8px 0 0",
            padding: "8px 10px",
            borderRadius: 4,
            border: `1px solid ${colors.border}`,
            fontSize: "calc(13px * var(--ae-fs, 1))",
            fontWeight: 600,
            color: colors.ink,
            cursor: "pointer",
          }}
        >
          <input type="checkbox" checked={gate.confirmed} onChange={(e) => gate.setConfirmed(e.target.checked)} />
          Yes, {formatDateLong(date)} is the right date
        </label>
      )}
    </div>
  );
}
