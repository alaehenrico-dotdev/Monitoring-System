import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./ui";
import { Spinner } from "./Spinner";
import {
  getVarianceTrace,
  setCountRemarks,
  type VarianceTrace,
} from "../api/manualCounts";
import type { Shift } from "../types";
import { colors } from "../theme";
import { formatDateDisplay } from "../utils/dateFormat";
import { SHIFT_SHORT_LABELS } from "../utils/shift";

type Loc = "ONLINE" | "OFFLINE";
const LOCATION_LABEL: Record<Loc, string> = { ONLINE: "Online", OFFLINE: "Offline" };

/// Quick picks for the usual reasons - the box still takes anything.
const REMARK_REASONS = ["Spoilage", "Damaged", "Miscount", "Unrecorded delivery", "Returned stock"];

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * "Why is this off, and who touched it" for one product on the Audit sheet:
 * per visible location, the count and its counter, where the opening stock
 * came from (and whether it broke the carry-forward), the movements behind the
 * system figure, a timeline of every change to the entry and the count (who,
 * when, whether after the count, whether automatic), and the remarks box that
 * records the reason.
 */
export function VarianceDetails({
  productId,
  productName,
  sku,
  date,
  shift,
  locations,
  canEdit,
  onClose,
  onRemarksSaved,
}: {
  productId: number;
  productName: string;
  sku: string | null;
  date: string;
  shift: Shift;
  locations: Loc[];
  canEdit: boolean;
  onClose: () => void;
  /// Lets the page pick up the new remarks without waiting for a refresh.
  onRemarksSaved?: (location: Loc, remarks: string | null) => void;
}) {
  return (
    <Modal
      title={`Variance details${sku ? ` · ${sku}` : ""} · ${productName}`}
      onClose={onClose}
      width={720}
    >
      <p style={{ margin: "0 0 12px", fontSize: 12.5, color: colors.subtleInk }}>
        {formatDateDisplay(date)} · {SHIFT_SHORT_LABELS[shift]} Shift
      </p>
      {locations.map((loc) => (
        <LocationTrace
          key={loc}
          productId={productId}
          date={date}
          shift={shift}
          location={loc}
          canEdit={canEdit}
          onRemarksSaved={onRemarksSaved}
        />
      ))}
    </Modal>
  );
}

function LocationTrace({
  productId,
  date,
  shift,
  location,
  canEdit,
  onRemarksSaved,
}: {
  productId: number;
  date: string;
  shift: Shift;
  location: Loc;
  canEdit: boolean;
  onRemarksSaved?: (location: Loc, remarks: string | null) => void;
}) {
  const [trace, setTrace] = useState<VarianceTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getVarianceTrace(productId, date, shift, location)
      .then((t) => {
        if (cancelled) return;
        setTrace(t);
        setRemarks(t.count?.remarks ?? "");
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load details");
      });
    return () => {
      cancelled = true;
    };
  }, [productId, date, shift, location]);

  async function saveRemarks() {
    setSaving(true);
    setError(null);
    try {
      const updated = await setCountRemarks(productId, date, shift, location, remarks);
      setSaved(true);
      setTrace((t) => (t?.count ? { ...t, count: { ...t.count, remarks: updated.remarks ?? null } } : t));
      onRemarksSaved?.(location, updated.remarks ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save remarks");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={sectionStyle} aria-label={`${LOCATION_LABEL[location]} details`}>
      <h4 style={headingStyle}>{LOCATION_LABEL[location]}</h4>
      {!trace && !error && <Spinner />}
      {error && (
        <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: "0 0 8px" }}>
          {error}
        </p>
      )}
      {trace && (
        <>
          {trace.count ? (
            <p style={lineStyle}>
              System <b>{trace.count.systemRemainingStock.toLocaleString()}</b> vs count{" "}
              <b>{trace.count.manualCount.toLocaleString()}</b> ={" "}
              <b style={{ color: trace.count.variance === 0 ? colors.ink : colors.warningText }}>
                variance {trace.count.variance.toLocaleString()}
              </b>
              {trace.count.countedBy && (
                <>
                  {" "}
                  · counted by <b>{trace.count.countedBy}</b>
                  {trace.count.countedAt && <> on {when(trace.count.countedAt)}</>}
                </>
              )}
            </p>
          ) : (
            <p style={lineStyle}>No count saved for this location yet.</p>
          )}

          {trace.count && (
            <p style={lineStyle}>
              {trace.count.publishedAt ? (
                <>Published {when(trace.count.publishedAt)} - this is the next shift's opening stock.</>
              ) : (
                <span style={{ color: colors.warningText }}>
                  Not published yet - the next shift still opens from the system stock until a supervisor publishes this sheet.
                </span>
              )}
            </p>
          )}

          <p style={lineStyle}>
            Opening stock <b>{trace.opening.actual.toLocaleString()}</b>
            {trace.opening.isBreak ? (
              <span style={{ color: colors.warningText }}>
                {" "}
                · does not match what carries forward ({trace.opening.expected.toLocaleString()} from the previous{" "}
                {trace.opening.source === "count" ? "count" : "closing stock"}) - it was set by an import
              </span>
            ) : (
              <span style={{ color: colors.subtleInk }}>
                {" "}
                · carried forward from the previous {trace.opening.source === "count" ? "count" : "closing stock"}
              </span>
            )}
          </p>

          {trace.entrySaved ? (
            <p style={lineStyle}>
              Movements:{" "}
              {trace.figures
                .filter((f) => f.label !== "Opening stock")
                .map((f) => `${f.label} ${f.value}`)
                .join(" · ") || "none"}
              {trace.encodedBy && <> · last entered by <b>{trace.encodedBy}</b></>}
            </p>
          ) : (
            <p style={lineStyle}>No stock entry was saved for this period, so the system figure is the carried-forward opening.</p>
          )}

          {trace.count && (
            <div style={{ margin: "10px 0" }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: colors.subtleInk, marginBottom: 4 }}>
                Remarks - why does the count differ?
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="ae-input"
                  list={`remark-reasons-${location}`}
                  value={remarks}
                  maxLength={500}
                  disabled={!canEdit || saving}
                  placeholder="e.g. Spoilage, damaged in transit…"
                  onChange={(e) => {
                    setRemarks(e.target.value);
                    setSaved(false);
                  }}
                  style={{ flex: 1 }}
                />
                <datalist id={`remark-reasons-${location}`}>
                  {REMARK_REASONS.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
                {canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void saveRemarks()}
                    disabled={saving || remarks.trim() === (trace.count.remarks ?? "")}
                  >
                    {saving ? "Saving…" : saved ? "Saved" : "Save remarks"}
                  </Button>
                )}
              </div>
            </div>
          )}

          <h5 style={{ ...headingStyle, fontSize: 12, marginTop: 12 }}>Change history</h5>
          {trace.history.length === 0 ? (
            <p style={{ ...lineStyle, color: colors.subtleInk }}>No recorded changes.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 220, overflowY: "auto" }}>
              {trace.history.map((h, i) => (
                <li key={`${h.at}-${i}`} style={itemStyle}>
                  <span style={{ color: colors.subtleInk, whiteSpace: "nowrap" }}>{when(h.at)}</span>
                  <span>
                    <b>{h.auto ? "System" : (h.who ?? "Unknown")}</b>{" "}
                    <span style={{ color: colors.subtleInk }}>
                      {h.what === "Count" ? "count" : "entry"}
                      {h.auto && h.who ? ` (after ${h.who}'s change)` : ""}:
                    </span>{" "}
                    {h.summary}
                    {h.afterCount && (
                      <span style={tagStyle} title="Made after the count was last saved">
                        after the count
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

const sectionStyle = {
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: "10px 12px",
  marginBottom: 12,
} as const;
const headingStyle = { margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: colors.ink } as const;
const lineStyle = { margin: "0 0 6px", fontSize: 13, lineHeight: 1.5, color: colors.ink } as const;
const itemStyle = {
  display: "grid",
  gridTemplateColumns: "110px 1fr",
  gap: 10,
  padding: "5px 0",
  fontSize: 12.5,
  borderBottom: `1px solid ${colors.border}`,
} as const;
const tagStyle = {
  marginLeft: 8,
  padding: "1px 7px",
  borderRadius: 999,
  border: `1px solid ${colors.border}`,
  background: colors.paperAlt,
  color: colors.warningText,
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: "nowrap",
} as const;
