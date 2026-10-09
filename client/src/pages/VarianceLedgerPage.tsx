import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getVarianceReport } from "../api/manualCounts";
import { PageHeader } from "../components/PageHeader";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { DateRangePicker } from "../components/DateRangePicker";
import { Dropdown } from "../components/Dropdown";
import { SearchInput } from "../components/SearchInput";
import { Toast } from "../components/Toast";
import { TableSkeleton } from "../components/Skeleton";
import { RowGlowScroll } from "../components/RowGlowScroll";
import { DownloadIcon, HistoryIcon } from "../components/icons";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { downloadCsv } from "../utils/csv";
import { matchesSearch } from "../utils/search";
import { formatDateDisplay } from "../utils/dateFormat";
import { buildVarianceLedger, varianceLedgerCsv, type LedgerCount } from "../utils/varianceLedger";
import { colors } from "../theme";

type Scope = "all" | "off" | "recurring";
const COLUMNS = ["", "SKU", "Product", "Counts", "Off", "Net", "Total discrepancy", "Last off", "Counted most by", "Explained"];

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
};

/**
 * Variance Ledger - which SKUs keep coming up short (or over), by how much,
 * who was counting, and whether anyone recorded why. Rolls every saved manual
 * count in a period up per SKU; open a row for the individual counts behind
 * it, with their remarks. Read-only and built from saved counts only.
 */
export function VarianceLedgerPage() {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const [location, setLocation] = useState("");
  const [scope, setScope] = useState<Scope>("off");
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<LedgerCount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const realtimeVersion = useRealtimeVersion();

  useEffect(() => {
    if (!from || !to) return;
    let cancelled = false;
    getVarianceReport({
      startDate: from,
      endDate: to,
      location: (location || undefined) as "ONLINE" | "OFFLINE" | undefined,
      flaggedOnly: false,
    })
      .then((data) => {
        if (!cancelled) setCounts(data as LedgerCount[]);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setCounts((cur) => cur ?? []);
        setError(e instanceof Error ? e.message : "Failed to load the ledger");
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, location, realtimeVersion]);

  const ledger = useMemo(() => buildVarianceLedger(counts ?? []), [counts]);
  const rows = useMemo(
    () =>
      ledger.filter(
        (r) =>
          (scope === "all" || (scope === "off" ? r.flagged > 0 : r.recurring)) &&
          matchesSearch([r.sku, r.name, r.category, r.topCounter?.name], query),
      ),
    [ledger, scope, query],
  );

  function changeFilters(apply: () => void) {
    setCounts(null);
    setOpen(null);
    apply();
  }

  return (
    <div>
      <PageHeader
        title="Variance Ledger"
        subtitle="Which SKUs keep coming up short or over, by how much, who was counting, and why. Built from saved manual counts."
      >
        <Toolbar className="no-print">
          <div>
            <DateRangePicker
              className="ae-fit"
              aria-label="Date range"
              from={from}
              to={to}
              onChange={(f, t) =>
                changeFilters(() => {
                  setFrom(f);
                  setTo(t);
                })
              }
            />
            <Dropdown
              className="ae-fit"
              aria-label="Location"
              value={location}
              onChange={(v) => changeFilters(() => setLocation(v))}
              options={[
                { value: "", label: "Online + Offline" },
                { value: "ONLINE", label: "Online" },
                { value: "OFFLINE", label: "Offline" },
              ]}
            />
            <Dropdown
              className="ae-fit"
              aria-label="Show"
              value={scope}
              onChange={(v) => setScope(v as Scope)}
              options={[
                { value: "off", label: "SKUs that were off" },
                { value: "recurring", label: "Recurring (off 2+ times)" },
                { value: "all", label: "Every counted SKU" },
              ]}
            />
          </div>
          <ToolbarControls>
            <SearchInput value={query} onChange={setQuery} placeholder="Search SKU, product or counter…" />
            <button
              type="button"
              className="ae-btn ae-btn-secondary"
              disabled={rows.length === 0}
              onClick={() => downloadCsv(`variance-ledger-${from}-to-${to}.csv`, varianceLedgerCsv(rows))}
              title="Download the listed SKUs as a CSV file"
            >
              <DownloadIcon /> Export CSV
            </button>
            <Link to="/variance-report" className="ae-btn ae-btn-secondary" style={{ textDecoration: "none" }}>
              <HistoryIcon /> Variance Report
            </Link>
          </ToolbarControls>
        </Toolbar>
      </PageHeader>

      <Toast message={error} onDismiss={() => setError(null)} variant="error" duration={null} />

      {!counts ? (
        <TableSkeleton headers={COLUMNS} minWidth={720} label="Loading the ledger…" />
      ) : counts.length === 0 ? (
        <p style={{ color: colors.subtleInk }}>No manual counts were saved in this period.</p>
      ) : rows.length === 0 ? (
        <p style={{ color: colors.subtleInk }}>
          {scope === "all" ? "No matching SKUs." : "Nothing matches - every counted SKU matched the system, or try \"Every counted SKU\"."}
        </p>
      ) : (
        <RowGlowScroll>
          <table className="ae-table" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                {COLUMNS.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const expanded = open === r.productId;
                return (
                  <Fragment key={r.productId}>
                    <tr
                      style={{ cursor: "pointer" }}
                      onClick={() => setOpen(expanded ? null : r.productId)}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setOpen(expanded ? null : r.productId);
                        }
                      }}
                      tabIndex={0}
                      aria-expanded={expanded}
                    >
                      <td style={{ color: colors.subtleInk }}>{expanded ? "▲" : "▼"}</td>
                      <td style={{ textAlign: "left", color: colors.yellow, whiteSpace: "nowrap" }}>{r.sku ?? "—"}</td>
                      <td style={{ textAlign: "left", color: colors.ink }}>
                        {r.name}
                        {r.recurring && (
                          <span style={tagStyle} title="Off two or more times in this period">
                            Recurring
                          </span>
                        )}
                      </td>
                      <td>{r.counts}</td>
                      <td style={{ fontWeight: 700, color: r.flagged ? colors.warningText : undefined }}>{r.flagged}</td>
                      <td style={{ color: r.net < 0 ? colors.danger : undefined }}>{r.net.toLocaleString()}</td>
                      <td style={{ fontWeight: 700 }}>{r.absolute.toLocaleString()}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.lastFlaggedDate ? formatDateDisplay(r.lastFlaggedDate) : "—"}</td>
                      <td style={{ textAlign: "left", whiteSpace: "nowrap" }}>
                        {r.topCounter ? `${r.topCounter.name} (${r.topCounter.times})` : "—"}
                      </td>
                      <td>{r.flagged ? `${r.explained}/${r.flagged}` : "—"}</td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={COLUMNS.length} style={{ padding: "8px 12px 16px", background: colors.paperAlt }}>
                          <table className="ae-table" style={{ fontSize: 12.5, minWidth: 0 }}>
                            <thead>
                              <tr>
                                {["Date", "Shift", "Location", "System", "Count", "Variance", "Counted by", "Remarks"].map((h) => (
                                  <th key={h} style={{ padding: "3px 10px" }}>
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {r.entries.map((e) => (
                                <tr key={e.id}>
                                  <td style={cell}>{e.entryDate.slice(0, 10)}</td>
                                  <td style={cell}>{e.shift ?? "—"}</td>
                                  <td style={cell}>{e.location}</td>
                                  <td style={cell}>{Number(e.systemRemainingStock).toLocaleString()}</td>
                                  <td style={cell}>{Number(e.manualCount).toLocaleString()}</td>
                                  <td style={{ ...cell, fontWeight: 700, color: Number(e.variance) === 0 ? undefined : Number(e.variance) < 0 ? colors.danger : colors.warningText }}>
                                    {Number(e.variance).toLocaleString()}
                                  </td>
                                  <td style={{ ...cell, textAlign: "left" }}>{e.countedBy?.name ?? "—"}</td>
                                  <td style={{ ...cell, textAlign: "left", color: e.remarks ? colors.ink : colors.subtleInk }}>
                                    {e.remarks || (Number(e.variance) !== 0 ? "No reason recorded" : "")}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </RowGlowScroll>
      )}
    </div>
  );
}

const cell = { padding: "3px 10px" } as const;
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
