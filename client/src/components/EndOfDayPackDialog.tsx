import { useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "./Modal";
import { Button } from "./ui";
import { DatePicker } from "./DatePicker";
import { Spinner } from "./Spinner";
import {
  buildEndOfDayPack,
  type PackResult,
  type PackStepId,
  type PackStepStatus,
} from "../utils/endOfDayPack";
import { findUnsavedWork } from "../utils/unsavedWork";
import { formatDateDisplay } from "../utils/dateFormat";
import { saveBlob } from "../utils/saveBlob";
import { colors } from "../theme";

type Phase = "setup" | "running" | "done";

interface StepState {
  status: PackStepStatus | "pending";
  detail?: string;
}

const STEP_LABEL: Record<PackStepId, string> = {
  daily: "Daily Report (PDF)",
  variance: "Variance Report (PDF)",
  backup: "Database backup (.sql)",
  zip: "Bundling into one .zip",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusText(s: StepState): string {
  switch (s.status) {
    case "pending":
      return "Waiting";
    case "running":
      return "Working…";
    case "done":
      return s.detail ? `Done - ${s.detail}` : "Done";
    case "skipped":
      return `Skipped - ${s.detail ?? ""}`;
    case "error":
      return `Failed - ${s.detail ?? ""}`;
  }
}

/**
 * Dashboard > "End-of-day pack": one dialog that doubles as the confirmation
 * step before the downloads. Pick the date, confirm, and the Daily Report PDF,
 * the Variance Report PDF and a database backup arrive as ONE .zip - a single
 * save prompt rather than three.
 *
 * Refuses to start while the chosen date still has staged-but-unsaved edits:
 * both reports read saved data only, so they would silently leave those
 * edits out (same rule as the report pages themselves).
 */
export function EndOfDayPackDialog({
  defaultDate,
  todayValue,
  onClose,
}: {
  defaultDate: string;
  todayValue: string;
  onClose: () => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [includeDaily, setIncludeDaily] = useState(true);
  const [includeVariance, setIncludeVariance] = useState(true);
  const [includeBackup, setIncludeBackup] = useState(true);
  const [phase, setPhase] = useState<Phase>("setup");
  const [steps, setSteps] = useState<Partial<Record<PackStepId, StepState>>>(
    {},
  );
  const [backupBytes, setBackupBytes] = useState(0);
  const [result, setResult] = useState<PackResult | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const unsaved = findUnsavedWork({ from: date, to: date });
  const nothingPicked = !includeDaily && !includeVariance && !includeBackup;
  const running = phase === "running";

  async function start() {
    const order: PackStepId[] = [];
    if (includeDaily) order.push("daily");
    if (includeVariance) order.push("variance");
    if (includeBackup) order.push("backup");
    order.push("zip");
    setSteps(
      Object.fromEntries(
        order.map((id) => [id, { status: "pending" } as StepState]),
      ),
    );
    setBackupBytes(0);
    setResult(null);
    setFatal(null);
    setPhase("running");
    try {
      const packed = await buildEndOfDayPack({
        date,
        includeDaily,
        includeVariance,
        includeBackup,
        onStep: (id, status, detail) =>
          setSteps((prev) => ({ ...prev, [id]: { status, detail } })),
        onBackupProgress: setBackupBytes,
      });
      if (packed.zip) saveBlob(packed.zip, packed.zipName);
      setResult(packed);
    } catch (e) {
      setFatal(e instanceof Error ? e.message : "Couldn't build the pack.");
    }
    setPhase("done");
  }

  return (
    <Modal
      title="End-of-day pack"
      onClose={running ? () => {} : onClose}
      width={520}
    >
      {phase === "setup" && (
        <>
          <p style={{ margin: "0 0 14px", fontSize: 13.5, lineHeight: 1.55 }}>
            Builds the day's reports and a database backup and saves them
            together as one <code>.zip</code>.
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <span
              style={{ fontSize: 12, fontWeight: 600, color: colors.subtleInk }}
            >
              Date
            </span>
            <DatePicker
              aria-label="Pack date"
              value={date}
              onChange={setDate}
              todayValue={todayValue}
              style={{ maxWidth: 180 }}
            />
          </div>
          <div style={{ display: "grid", gap: 8, fontSize: 13.5 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={includeDaily}
                onChange={(e) => setIncludeDaily(e.target.checked)}
              />
              Daily Report PDF (Online + Offline + Total)
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={includeVariance}
                onChange={(e) => setIncludeVariance(e.target.checked)}
              />
              Variance Report PDF
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={includeBackup}
                onChange={(e) => setIncludeBackup(e.target.checked)}
              />
              Database backup (the whole database, not just this date)
            </label>
          </div>

          {unsaved.length > 0 && (
            <div
              role="alert"
              style={{
                marginTop: 14,
                fontSize: 13,
                lineHeight: 1.5,
                color: colors.danger,
              }}
            >
              <strong>Unsaved changes for {formatDateDisplay(date)}.</strong>{" "}
              The reports only include saved data - save these first:
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {unsaved.map((item) => (
                  <li
                    key={`${item.page}:${item.date}:${item.shift}:${item.location ?? ""}`}
                  >
                    <Link
                      to={item.route}
                      onClick={onClose}
                      style={{ color: "inherit", fontWeight: 600 }}
                    >
                      {item.page}
                    </Link>
                    {" - "}
                    {item.shift}
                    {item.location ? `, ${item.location}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 20,
            }}
          >
            <Button variant="secondary" onClick={onClose} autoFocus>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={start}
              disabled={nothingPicked || unsaved.length > 0}
            >
              Build pack
            </Button>
          </div>
        </>
      )}

      {phase !== "setup" && (
        <>
          <div
            style={{ display: "grid", gap: 8, fontSize: 13.5 }}
            role="status"
            aria-live="polite"
          >
            {(Object.keys(STEP_LABEL) as PackStepId[])
              .filter((id) => steps[id])
              .map((id) => {
                const state = steps[id] as StepState;
                const showBytes =
                  id === "backup" &&
                  state.status === "running" &&
                  backupBytes > 0;
                return (
                  <div
                    key={id}
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span
                      style={{
                        width: 16,
                        display: "inline-flex",
                        justifyContent: "center",
                      }}
                    >
                      {state.status === "running" ? (
                        <Spinner size="sm" />
                      ) : state.status === "done" ? (
                        "✓"
                      ) : state.status === "error" ? (
                        "✕"
                      ) : state.status === "skipped" ? (
                        "–"
                      ) : (
                        "·"
                      )}
                    </span>
                    <span style={{ flex: 1 }}>{STEP_LABEL[id]}</span>
                    <span
                      style={{
                        fontSize: 12,
                        color:
                          state.status === "error"
                            ? colors.danger
                            : colors.subtleInk,
                      }}
                    >
                      {showBytes ? formatBytes(backupBytes) : statusText(state)}
                    </span>
                  </div>
                );
              })}
          </div>

          {phase === "done" && (
            <div style={{ marginTop: 16, fontSize: 13.5, lineHeight: 1.55 }}>
              {fatal && (
                <div role="alert" style={{ color: colors.danger }}>
                  {fatal}
                </div>
              )}
              {result?.zip && (
                <div>
                  Saved <strong>{result.zipName}</strong> (
                  {formatBytes(result.zip.size)}, {result.files.length} file
                  {result.files.length === 1 ? "" : "s"}).
                </div>
              )}
              {result && !result.zip && (
                <div role="alert" style={{ color: colors.danger }}>
                  Nothing could be built, so no file was saved.
                </div>
              )}
              {result && result.problems.length > 0 && (
                <ul
                  style={{
                    margin: "8px 0 0",
                    paddingLeft: 18,
                    color: colors.danger,
                  }}
                >
                  {result.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 20,
            }}
          >
            {phase === "done" && (
              <Button variant="secondary" onClick={() => setPhase("setup")}>
                Build another
              </Button>
            )}
            <Button variant="primary" onClick={onClose} disabled={running}>
              {running ? "Working…" : "Close"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
