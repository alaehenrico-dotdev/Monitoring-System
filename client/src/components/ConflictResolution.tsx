import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./ui";
import { colors } from "../theme";
import type { PendingConflict } from "../hooks/usePendingEntryChanges";

type Choice = "mine" | "server";

/// Side-by-side reconciliation for staged edits whose underlying server value
/// changed after they were made - typically because they were entered while
/// offline (or before another user saved) and are now being re-synced. Each
/// row shows the value the edit started from, what the server has now, and
/// what this device wants to save; the user keeps one or the other.
///
/// Opens itself whenever a new conflict appears, and leaves a banner behind
/// once dismissed so the pending conflicts (which also block Save) can be
/// reopened.
export function ConflictResolution({
  conflicts,
  onResolve,
}: {
  conflicts: PendingConflict[];
  onResolve: (conflict: PendingConflict, choice: Choice) => void;
}) {
  const [open, setOpen] = useState(false);
  const previousCount = useRef(0);

  useEffect(() => {
    if (conflicts.length > previousCount.current) setOpen(true);
    previousCount.current = conflicts.length;
  }, [conflicts.length]);

  if (conflicts.length === 0) return null;

  const resolveAll = (choice: Choice) => conflicts.forEach((c) => onResolve(c, choice));
  const cell = { textAlign: "left" as const };

  return (
    <>
      <p role="alert" style={{ fontSize: 12.5, color: colors.warningText, margin: "0 0 8px" }}>
        ⚠ {conflicts.length} unsaved edit{conflicts.length === 1 ? "" : "s"} conflict{conflicts.length === 1 ? "s" : ""} with newer data on the server.{" "}
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{ background: "none", border: 0, padding: 0, color: "inherit", font: "inherit", fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}
        >
          Resolve
        </button>{" "}
        before saving.
      </p>
      {open && (
        <Modal title="Resolve sync conflicts" onClose={() => setOpen(false)} width={860}>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: colors.subtleInk }}>
            These fields were changed on the server after you started editing them. Choose which value to keep for each - "Keep mine"
            overwrites the server's newer value when you Save.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="ae-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Field</th>
                  <th>Original</th>
                  <th>Server now</th>
                  <th>Your change</th>
                  <th>Keep</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c) => (
                  <tr key={`${c.productId}-${c.key}`}>
                    <td style={{ ...cell, color: colors.ink }}>{c.name}</td>
                    <td style={{ ...cell, color: colors.ink }}>{c.label}</td>
                    <td style={{ color: colors.subtleInk }}>{c.baseValue.toLocaleString()}</td>
                    <td style={{ fontWeight: 700, background: colors.warningBg, color: colors.warningText }}>{c.serverValue.toLocaleString()}</td>
                    <td style={{ fontWeight: 700, color: colors.yellow }}>{c.myValue.toLocaleString()}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Button type="button" size="sm" variant="secondary" onClick={() => onResolve(c, "server")} style={{ marginRight: 6 }}>
                        Server
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => onResolve(c, "mine")}>
                        Mine
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
              Decide later
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => resolveAll("server")}>
              Keep all server values
            </Button>
            <Button type="button" size="sm" onClick={() => resolveAll("mine")}>
              Keep all mine
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
