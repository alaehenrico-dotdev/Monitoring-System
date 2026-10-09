import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listReportHistory,
  type ReportHistoryEntry,
} from "../api/reportHistory";
import { matchesSearch } from "../utils/search";
import { describe, parseDay } from "../utils/reportHistoryText";
import { reportHistoryCsv } from "../utils/reportHistoryCsv";
import { downloadCsv } from "../utils/csv";
import { CalendarIcon, ClockIcon, DownloadIcon, HistoryIcon } from "../components/icons";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { PageHeader } from "../components/PageHeader";
import { SearchInput } from "../components/SearchInput";
import { Toast } from "../components/Toast";
import { TableSkeleton } from "../components/Skeleton";
import { useRealtimeVersion } from "../context/RealtimeContext";

type HistoryType = ReportHistoryEntry["type"];

interface Props {
  type: HistoryType;
  title: string;
  subtitle: string;
  /// The report page this history belongs to ("Back to ..." + the empty-state link).
  backTo: string;
  backLabel: string;
}

/**
 * Shared body of the Daily / Variance Report History pages. Each generated
 * report is a glass card (what it covers, when it was generated, one-click
 * Download) and the cards are grouped under Today / Yesterday / date
 * headings, newest first - instead of the old flat three-column table.
 * Server-backed (api/reportHistory.ts) - the same list for every device and
 * tester, not just whichever browser happened to generate a given report.
 */
export function ReportHistoryPage({
  type,
  title,
  subtitle,
  backTo,
  backLabel,
}: Props) {
  const [history, setHistory] = useState<ReportHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const realtimeVersion = useRealtimeVersion();

  useEffect(() => {
    listReportHistory(type)
      .then(setHistory)
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Failed to load report history",
        ),
      );
  }, [type, realtimeVersion]);

  const visible = useMemo(
    () =>
      (history ?? []).filter((e) =>
        matchesSearch(
          [e.scope, describe(e).title, describe(e).category],
          query,
        ),
      ),
    [history, query],
  );

  // Group by the local day each report was generated on; input is already
  // newest-first, and Map preserves insertion order.
  const groups = useMemo(() => {
    const map = new Map<string, ReportHistoryEntry[]>();
    for (const entry of visible) {
      const key = dayKey(entry.generatedAt);
      const bucket = map.get(key);
      if (bucket) bucket.push(entry);
      else map.set(key, [entry]);
    }
    return Array.from(map.entries());
  }, [visible]);

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle}>
        <Toolbar className="no-print">
          <Link
            to={backTo}
            className="ae-btn ae-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            {backLabel}
          </Link>
          <ToolbarControls>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search by date or category…"
            />
            <button
              type="button"
              className="ae-btn ae-btn-secondary"
              disabled={visible.length === 0}
              onClick={() =>
                downloadCsv(
                  `${type.toLowerCase().replace(/\s+/g, "-")}-history-${new Date().toISOString().slice(0, 10)}.csv`,
                  reportHistoryCsv(visible),
                )
              }
              title="Download the listed reports as a CSV file"
            >
              <DownloadIcon /> Export CSV
            </button>
          </ToolbarControls>
        </Toolbar>
      </PageHeader>

      <Toast
        message={error}
        onDismiss={() => setError(null)}
        variant="error"
        duration={null}
      />
      {!history ? (
        <TableSkeleton
          headers={["Report"]}
          label={`Loading ${type} history…`}
        />
      ) : history.length === 0 ? (
        <div className="ae-hist-empty">
          <span className="ae-hist-empty-icon">
            <HistoryIcon />
          </span>
          <h3>No generated {type} entries yet</h3>
          <p>
            Every {type} you open is listed here so you can download it again
            later.
          </p>
          <Link
            to={backTo}
            className="ae-btn ae-btn-primary"
            style={{ textDecoration: "none" }}
          >
            Go to {type}
          </Link>
        </div>
      ) : visible.length === 0 ? (
        <p className="ae-hist-none">No matching entries.</p>
      ) : (
        <div className="ae-hist">
          <p className="ae-hist-count">
            {visible.length} {visible.length === 1 ? "report" : "reports"}
            {query.trim() && ` matching "${query.trim()}"`}
          </p>
          {groups.map(([day, entries]) => (
            <Fragment key={day}>
              <h3 className="ae-hist-day">
                {dayHeading(day)}
                <span>{entries.length}</span>
              </h3>
              <div className="ae-hist-grid">
                {entries.map((entry) => (
                  <HistoryCard key={entry.id} entry={entry} />
                ))}
              </div>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryCard({ entry }: { entry: ReportHistoryEntry }) {
  const { title, detail, category } = describe(entry);
  return (
    <article className="ae-hist-card">
      <span className="ae-hist-card-icon" aria-hidden>
        <CalendarIcon />
      </span>
      <div className="ae-hist-card-body">
        <h4 className="ae-hist-card-title">{title}</h4>
        <p className="ae-hist-card-meta">
          {detail && <span className="ae-hist-chip">{detail}</span>}
          {category && (
            <span className="ae-hist-chip ae-hist-chip--accent">
              {category}
            </span>
          )}
        </p>
        <p
          className="ae-hist-card-time"
          title={new Date(entry.generatedAt).toLocaleString()}
        >
          <ClockIcon />
          Generated {timeOfDay(entry.generatedAt)} ·{" "}
          {relativeTime(entry.generatedAt)}
          {entry.generatedBy && <> · {entry.generatedBy.name}</>}
        </p>
      </div>
      {/* Still a navigation under the hood (the report page re-fetches live
          data for this exact date/range and auto-triggers the PDF - see
          DailyReportPage.tsx/VarianceReportPage.tsx's `printAfterLoad`), but
          presented as the one-click Download it functionally already is,
          rather than "open this page". */}
      <Link
        to={entry.route}
        className="ae-btn ae-btn-secondary ae-btn-sm ae-hist-open"
        style={{ textDecoration: "none" }}
      >
        <DownloadIcon />
        Download
      </Link>
    </article>
  );
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayHeading(key: string): string {
  const d = parseDay(key);
  if (!d) return key;
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const diff = Math.round((startOfToday.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const timeOfDay = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (seconds < 60) return "just now";
  if (seconds < 3600) return rtf.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86_400) return rtf.format(-Math.floor(seconds / 3600), "hour");
  return rtf.format(-Math.floor(seconds / 86_400), "day");
}
