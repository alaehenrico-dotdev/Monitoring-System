import { useEffect, useMemo, useState } from "react";
import { getDailyOut, type DailyOutEntry } from "../api/dailyOut";
import { ComboChart } from "../components/ComboChart";
import { hasLines } from "../utils/comboChartData";
import { DateStepper } from "../components/DateStepper";
import { Dropdown } from "../components/Dropdown";
import { DownloadIcon } from "../components/icons";
import { FilterSlot } from "../components/FilterSlot";
import { PageHeader } from "../components/PageHeader";
import { PageToolbar } from "../components/PageToolbar";
import { BarsSkeleton } from "../components/Skeleton";
import { Toast } from "../components/Toast";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { fullNumber } from "../utils/chartFormat";
import { downloadCsv } from "../utils/csv";
import { dailyOutCsv, dailyOutPoints, dailyOutTotals } from "../utils/dailyOut";
import { formatDateDisplay } from "../utils/dateFormat";
import { getCurrentShiftAndDate } from "../utils/shift";

type View = "chart" | "table";

const DEFAULT_DAYS = 14;
const DAY_OPTIONS = [7, 14, 30];

/// "YYYY-MM-DD", `n` days before `date`, built from the parts so a timezone
/// behind UTC can't shift it.
function daysBefore(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const out = new Date(y, m - 1, d - n);
  return `${out.getFullYear()}-${String(out.getMonth() + 1).padStart(2, "0")}-${String(out.getDate()).padStart(2, "0")}`;
}

const cell = (v: number | null) => (v === null ? "—" : fullNumber.format(v));

/**
 * Daily Out - how much stock left the company each day: what Online
 * fulfilled, what Offline delivered (less backloads), and the two together.
 * Read-only and built from the same entries as every other page, so it can
 * never disagree with them. A day nobody encoded is a gap, not a zero.
 */
export function DailyOutPage() {
  const today = getCurrentShiftAndDate().date;
  // The selected date is the last day shown; the window runs back from it.
  const [to, setTo] = useState(today);
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [view, setView] = useState<View>("table");
  const from = daysBefore(to, days - 1);
  const [rows, setRows] = useState<DailyOutEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const realtimeVersion = useRealtimeVersion();

  useEffect(() => {
    // Also re-runs on every realtime tick so today's bar follows the entry
    // grids. A refetch keeps the old chart on screen; only changing the date or
    // window (see changeWindow) goes back to the skeleton.
    let cancelled = false;
    getDailyOut(from, to)
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setRows((cur) => cur ?? []);
        setError(e instanceof Error ? e.message : "Failed to load Daily Out");
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, realtimeVersion]);

  const points = useMemo(() => (rows ? dailyOutPoints(rows, today) : null), [rows, today]);
  const totals = useMemo(() => (rows ? dailyOutTotals(rows) : null), [rows]);

  function changeWindow(apply: () => void) {
    setRows(null);
    apply();
  }

  return (
    <div>
      <PageHeader
        title={`Daily Out - last ${days} days to ${formatDateDisplay(to)}`}
        subtitle="Stock leaving the company each day: Online fulfilled, Offline delivered, and both combined."
      >
        <PageToolbar
          label="Daily Out"
          menus={[
            {
              id: "export",
              label: "Export",
              sections: [
                {
                  items: [
                    {
                      id: "csv",
                      label: "Export CSV",
                      icon: <DownloadIcon />,
                      disabledReason: rows && rows.length > 0 ? undefined : "Nothing to export yet",
                      onSelect: () => rows && downloadCsv(`daily-out-${from}-to-${to}.csv`, dailyOutCsv(rows)),
                    },
                  ],
                },
              ],
            },
          ]}
          filters={
            <>
              <FilterSlot active={days !== DEFAULT_DAYS} label="Days shown">
                <Dropdown
                  className="ae-fit"
                  aria-label="Days shown"
                  value={String(days)}
                  onChange={(v) => changeWindow(() => setDays(Number(v)))}
                  options={DAY_OPTIONS.map((n) => ({ value: String(n), label: `Last ${n} days` }))}
                />
              </FilterSlot>
              <DateStepper
                value={to}
                onChange={(d) => changeWindow(() => setTo(d))}
                todayValue={today}
              />
            </>
          }
        />
      </PageHeader>

      <Toast message={error} onDismiss={() => setError(null)} variant="error" duration={null} />

      <div className="ae-dash-card">
        <h3 className="ae-dash-heading ae-mm-heading">
          Out per day
          <span className="ae-mm-view" role="group" aria-label="Chart view">
            {(["table", "chart"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className="ae-mm-view-btn"
                aria-pressed={view === v}
                onClick={() => setView(v)}
              >
                {v === "chart" ? "Chart" : "Table"}
              </button>
            ))}
          </span>
        </h3>
        {!rows || !points || !totals ? (
          <BarsSkeleton count={Math.min(days, 14)} chartHeight={240} label="Loading Daily Out…" />
        ) : (
          <div className="ae-mm-body">
            {view === "chart" ? (
              <ComboChart
                points={points}
                barLabel="Combined out"
                lineLabels={{ online: "Online out", offline: "Offline out" }}
              />
            ) : (
              <DailyOutTable rows={rows} totals={totals} />
            )}
            <p className="ae-mm-note">
              {totals.days === 0
                ? "Nothing was recorded in this period."
                : `Over ${totals.days} ${totals.days === 1 ? "day" : "days"} with entries: ${fullNumber.format(totals.onlineOut)} out of Online, ${fullNumber.format(totals.offlineOut)} out of Offline, ${fullNumber.format(totals.totalOut)} combined. `}
              Offline is deliveries and upsells less backloads; moving stock
              between Online and Offline is not counted as out.
              {view === "chart" && points && totals.days > 0 && !hasLines(points) &&
                " A line needs two consecutive days with entries, so until then each day shows as a dot."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function DailyOutTable({
  rows,
  totals,
}: {
  rows: DailyOutEntry[];
  totals: ReturnType<typeof dailyOutTotals>;
}) {
  return (
    <div className="ae-mm-tablewrap">
      <table className="ae-table ae-table--compact">
        <thead>
          <tr>
            {["Date", "Online out", "Offline out", "Combined out"].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.date}>
              <td>{formatDateDisplay(e.date)}</td>
              <td>{cell(e.onlineOut)}</td>
              <td>{cell(e.offlineOut)}</td>
              <td>{cell(e.totalOut)}</td>
            </tr>
          ))}
          <tr className="ae-row-grand">
            <td>Total</td>
            <td>{fullNumber.format(totals.onlineOut)}</td>
            <td>{fullNumber.format(totals.offlineOut)}</td>
            <td>{fullNumber.format(totals.totalOut)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
