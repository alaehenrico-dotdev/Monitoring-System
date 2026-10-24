import { Fragment, useEffect, useMemo, useState } from "react";
import { getPeriodMonitoring, type PeriodMonitoring, type PeriodTotals } from "../api/periodMonitoring";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { fullNumber } from "../utils/chartFormat";
import { downloadCsv } from "../utils/csv";
import {
  backloadRate,
  deltaOf,
  periodCsv,
  periodRange,
  periodTitle,
  shiftPeriod,
  type Delta,
  type PeriodKind,
} from "../utils/periodMonitoring";
import { getCurrentShiftAndDate } from "../utils/shift";
import { Button } from "./ui";
import { DatePicker } from "./DatePicker";
import { DownloadIcon } from "./icons";
import { BarsSkeleton } from "./Skeleton";

const KIND_LABEL: Record<PeriodKind, string> = { week: "Weekly", month: "Monthly" };

interface Tile {
  key: keyof PeriodTotals;
  label: string;
  hint?: string;
}

const TILES: Tile[] = [
  { key: "totalOut", label: "Total out", hint: "Online fulfilled + Offline delivered and upsold, less backloads" },
  { key: "onlineOut", label: "Online out" },
  { key: "offlineOut", label: "Offline out", hint: "Deliveries + upsells less backloads" },
  { key: "backloads", label: "Backloads", hint: "Undelivered stock returned by delivery routes" },
  { key: "rts", label: "RTS", hint: "Returned to stock (Online)" },
  { key: "productionIn", label: "Production in", hint: "Online + Offline" },
  { key: "netVariance", label: "Net variance", hint: "Counted minus system; gains and losses cancel" },
  { key: "absVariance", label: "Absolute variance", hint: "Total size of the discrepancies, ignoring direction" },
  { key: "flaggedProducts", label: "Products with variance" },
];

const fmt = (v: number) => fullNumber.format(v);

/**
 * Dashboard > Weekly / Monthly Monitoring - what moved over a week (Mon-Sun) or
 * a calendar month: stock out, backloads, RTS, production and audit variance, in
 * total and per product, with the change against the previous period. Read-only
 * and built from the same entries and counts as every other page. Variance comes
 * from manual counts, so it covers only the days someone counted - the card says
 * how many there were.
 */
export function PeriodMonitoringCard() {
  const today = getCurrentShiftAndDate().date;
  const [kind, setKind] = useState<PeriodKind>("week");
  const [anchor, setAnchor] = useState(today);
  const { from, to } = periodRange(kind, anchor);
  const prev = periodRange(kind, shiftPeriod(kind, anchor, -1));
  const [loaded, setData] = useState<PeriodMonitoring | null>(null);
  const [loadedPrevious, setPrevious] = useState<PeriodMonitoring | null>(null);
  // Only figures for the period on screen are shown: a different period starts
  // from the skeleton, a refresh of the same one keeps its figures meanwhile.
  // Derived from the period itself, not from whoever changed the date, so picking
  // another day inside the same week can never leave the card waiting on a fetch
  // that does not come.
  const data = loaded && loaded.from === from && loaded.to === to ? loaded : null;
  const previous = loadedPrevious && loadedPrevious.from === prev.from && loadedPrevious.to === prev.to ? loadedPrevious : null;
  const [error, setError] = useState<string | null>(null);
  const realtimeVersion = useRealtimeVersion();

  useEffect(() => {
    // Also re-runs on a realtime tick so the open period follows the entry
    // grids; a refetch keeps the old figures on screen. The previous period is
    // best effort - without it the changes are simply not shown.
    let cancelled = false;
    getPeriodMonitoring(from, to)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Unable to load monitoring");
      });
    getPeriodMonitoring(prev.from, prev.to)
      .then((d) => !cancelled && setPrevious(d))
      .catch(() => !cancelled && setPrevious(null));
    return () => {
      cancelled = true;
    };
    // prev.* derive from the same period, which `kind` and `anchor` fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, realtimeVersion]);

  function move(apply: () => void) {
    setError(null);
    apply();
  }

  const groups = useMemo(() => {
    const map = new Map<string, PeriodMonitoring["products"]>();
    for (const p of data?.products ?? []) {
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }
    return [...map.entries()];
  }, [data]);

  const atCurrent = to >= today && from <= today;

  return (
    <section className="ae-dash-section">
      <div className="ae-dash-card">
        <h3 className="ae-dash-heading ae-mm-heading">
          {KIND_LABEL[kind]} Monitoring · {periodTitle(kind, from, to)}
          <span className="ae-mm-controls">
            <span className="ae-mm-view" role="group" aria-label="Period">
              {(Object.keys(KIND_LABEL) as PeriodKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="ae-mm-view-btn"
                  aria-pressed={kind === k}
                  onClick={() => k !== kind && move(() => setKind(k))}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </span>
            <span className="ae-mm-year">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => move(() => setAnchor(shiftPeriod(kind, anchor, -1)))}
                aria-label={`Previous ${kind}`}
              >
                ‹
              </Button>
              <DatePicker
                aria-label="Date in period"
                value={anchor}
                onChange={(d) => d && move(() => setAnchor(d))}
                todayValue={today}
                style={{ maxWidth: 150 }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => move(() => setAnchor(shiftPeriod(kind, anchor, 1)))}
                disabled={atCurrent}
                aria-label={`Next ${kind}`}
              >
                ›
              </Button>
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!data || data.products.length === 0}
              title="Export this period as CSV"
              onClick={() => data && downloadCsv(`${kind}ly-monitoring-${from}-to-${to}.csv`, periodCsv(data))}
            >
              <DownloadIcon /> CSV
            </Button>
          </span>
        </h3>

        {error ? (
          <p className="ae-mm-error">{error}</p>
        ) : !data ? (
          <BarsSkeleton count={9} chartHeight={160} label="Loading monitoring…" />
        ) : (
          <div className="ae-mm-body">
            <div className="ae-dash-stats" style={{ marginBottom: 12 }}>
              {TILES.map((t) => (
                <div key={t.key} className="ae-dash-stat" title={t.hint}>
                  <div className="ae-dash-stat-value">{fmt(data.totals[t.key])}</div>
                  <div className="ae-dash-stat-label">{t.label}</div>
                  <DeltaText delta={deltaOf(data.totals[t.key], previous?.totals[t.key])} unit={kind} />
                </div>
              ))}
            </div>

            {data.products.length === 0 ? (
              <p className="ae-mm-note">Nothing was recorded in this period.</p>
            ) : (
              <div className="ae-mm-tablewrap">
                <table className="ae-table ae-table--center-head ae-table--compact">
                  <thead>
                    <tr>
                      {["SKU", "Product", "Online out", "Offline out", "Total out", "Backloads", "RTS", "Production in", "Net var.", "Abs. var."].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(([category, rows]) => (
                      <Fragment key={category}>
                        <tr className="ae-row-category">
                          <td colSpan={10}>{category || "Uncategorised"}</td>
                        </tr>
                        {rows.map((p) => (
                          <tr key={p.productId}>
                            <td>{p.sku ?? ""}</td>
                            <td style={{ textAlign: "left" }}>{p.name}</td>
                            <td>{fmt(p.onlineOut)}</td>
                            <td>{fmt(p.offlineOut)}</td>
                            <td>{fmt(p.totalOut)}</td>
                            <td>{fmt(p.backloads)}</td>
                            <td>{fmt(p.rts)}</td>
                            <td>{fmt(p.productionIn)}</td>
                            <td>{fmt(p.netVariance)}</td>
                            <td>{fmt(p.absVariance)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                    <tr className="ae-row-grand">
                      <td />
                      <td style={{ textAlign: "left" }}>Total</td>
                      <td>{fmt(data.totals.onlineOut)}</td>
                      <td>{fmt(data.totals.offlineOut)}</td>
                      <td>{fmt(data.totals.totalOut)}</td>
                      <td>{fmt(data.totals.backloads)}</td>
                      <td>{fmt(data.totals.rts)}</td>
                      <td>{fmt(data.totals.productionIn)}</td>
                      <td>{fmt(data.totals.netVariance)}</td>
                      <td>{fmt(data.totals.absVariance)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <p className="ae-mm-note">
              {data.totals.countedDays === 0
                ? "No audit counts were saved in this period, so there is no variance to report. "
                : `Variance covers the ${data.totals.countedDays} ${data.totals.countedDays === 1 ? "day" : "days"} with an audit count out of ${data.days}. `}
              {(() => {
                const rate = backloadRate(data.totals);
                return rate === null ? "" : `Backloads were ${rate}% of everything that went out. `;
              })()}
              Totals add up each product in its own unit; transfers between Online and Offline are not counted as out.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function DeltaText({ delta, unit }: { delta: Delta | null; unit: PeriodKind }) {
  if (!delta) return null;
  if (delta.diff === 0) return <span className="ae-dash-stat-delta">No change vs previous {unit}</span>;
  const arrow = delta.diff > 0 ? "▲" : "▼";
  const pct = delta.pct === null ? "" : ` (${delta.pct > 0 ? "+" : ""}${delta.pct}%)`;
  return (
    <span className="ae-dash-stat-delta" title={`Compared with the previous ${unit}`}>
      {arrow} {fmt(Math.abs(delta.diff))}
      {pct} vs previous {unit}
    </span>
  );
}
