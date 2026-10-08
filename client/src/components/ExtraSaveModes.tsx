import { memo } from "react";
import { colors } from "../theme";
import type { ExtraSaveColumn, ExtraSaveMode } from "../hooks/useExtraColumns";

const OPTIONS: { mode: ExtraSaveMode; label: string; hint: string }[] = [
  {
    mode: "total",
    label: "Save total only",
    hint: "The column saves the total; the added columns are cleared once it saves.",
  },
  {
    mode: "individual",
    label: "Save individually",
    hint: "The column saves the total and each added amount is stored, so the columns come back after a reload.",
  },
];

/**
 * The "Review and save changes" dialog's extra-columns section: one switch per
 * main column that currently has amounts in its added columns (see
 * hooks/useExtraColumns.ts). Renders nothing at all when there are none, so a
 * sheet without added columns gets exactly the dialog it has always had.
 *
 * `individualEnabled` is false until the server can store the individual
 * amounts (Phase 2) - the option is still shown, so the choice it represents
 * is visible, but disabled with a reason rather than silently missing.
 */
export const ExtraSaveModes = memo(function ExtraSaveModes({
  columns,
  getMode,
  onChange,
  individualEnabled = false,
}: {
  columns: ExtraSaveColumn[];
  getMode: (mainKey: string) => ExtraSaveMode;
  onChange: (mainKey: string, mode: ExtraSaveMode) => void;
  individualEnabled?: boolean;
}) {
  if (columns.length === 0) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <h4
        style={{
          margin: "0 0 8px",
          fontSize: 12.5,
          fontWeight: 700,
          letterSpacing: "0.02em",
          color: colors.subtleInk,
        }}
      >
        Extra columns
      </h4>
      {columns.map((col) => {
        const mode = individualEnabled ? getMode(col.mainKey) : "total";
        return (
          <div key={col.mainKey} className="ae-extra-savemode">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.ink }}>
                {col.label}
              </div>
              <div style={{ fontSize: 11.5, color: colors.subtleInk }}>
                {col.count} added column{col.count === 1 ? "" : "s"} &middot;
                total {col.total.toLocaleString()}
              </div>
            </div>
            <div
              role="radiogroup"
              aria-label={`How to save ${col.label}'s extra columns`}
              className="ae-extra-savemode-switch"
            >
              {OPTIONS.map((opt) => {
                const disabled = opt.mode === "individual" && !individualEnabled;
                return (
                  <button
                    key={opt.mode}
                    type="button"
                    role="radio"
                    aria-checked={mode === opt.mode}
                    disabled={disabled}
                    title={disabled ? "Needs server support" : opt.hint}
                    className={
                      mode === opt.mode
                        ? "ae-extra-savemode-opt ae-extra-savemode-opt--on"
                        : "ae-extra-savemode-opt"
                    }
                    onClick={() => onChange(col.mainKey, opt.mode)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
});
