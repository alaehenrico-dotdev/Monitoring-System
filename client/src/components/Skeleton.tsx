import type { CSSProperties, ReactNode } from "react";

/**
 * Structural loading placeholders (Section: Loading system). Every page that
 * fetches its own data before it can render anything meaningful (a table, a
 * stat card, a chart) should show one of these - sized and shaped like the
 * real content - instead of a blank pane or a spinner floating in empty
 * space. The shimmer itself is pure CSS (`.ae-skeleton`, index.css) driven
 * by `background-position`, so it never touches the main thread and is
 * automatically flattened to a static tint under `prefers-reduced-motion`.
 */
export function Skeleton({
  width = "100%",
  height = 14,
  radius = 4,
  style,
  className = "",
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`ae-skeleton ${className}`.trim()}
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/// A stack of text-line skeletons with varied widths (the last line shorter,
/// like a real paragraph/label trailing off) rather than identical uniform
/// bars, which reads more obviously as "text is coming" than a block would.
export function SkeletonText({ lines = 1, lineHeight = 12, gap = 6 }: { lines?: number; lineHeight?: number; gap?: number }) {
  const widths = ["92%", "78%", "85%", "64%"];
  return (
    <span aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={lineHeight} width={widths[i % widths.length]} />
      ))}
    </span>
  );
}

export function SkeletonCircle({ size = 32 }: { size?: number }) {
  return <Skeleton width={size} height={size} radius="50%" />;
}

/// Wraps any group of Skeleton pieces with the ARIA a screen reader actually
/// needs (`role="status"`/`aria-busy` + one visually-hidden announcement) -
/// the individual bars themselves stay `aria-hidden` (see Skeleton above)
/// since they're purely decorative shape, not content.
export function SkeletonRegion({ label = "Loading…", children, style }: { label?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" style={style}>
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * Mirrors a real `.ae-table` while its rows are still loading: keeps the
 * real `<thead>` (headers render instantly - there's nothing to wait on
 * there) and only skeletons the body, so column widths/borders/padding
 * match the eventual real table exactly instead of an approximation built
 * from scratch. `cellPadding` should match whatever padding the real table
 * uses (plain `.ae-table` cells are 4px 8px; inside `.ae-dash-card` they're
 * 8px 12px - see index.css) so the skeleton's row height doesn't visibly
 * jump once real rows swap in.
 */
export function TableSkeleton({
  headers,
  rows = 8,
  minWidth,
  cellPadding = "4px 8px",
  label = "Loading…",
}: {
  headers: string[];
  rows?: number;
  minWidth?: number | string;
  cellPadding?: string;
  label?: string;
}) {
  // A fixed cycle of widths (not all identical, not random-per-render) so
  // cells read as varied "text of different lengths" rather than a
  // uniform grid, while still being deterministic across re-renders.
  const widthCycle = [80, 55, 70, 45, 62, 90, 50];

  return (
    <SkeletonRegion label={label}>
      <table className="ae-table ae-table--left" style={{ minWidth }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {headers.map((h, c) => (
                <td key={h} style={{ padding: cellPadding }}>
                  <Skeleton height={12} width={`${widthCycle[(r + c) % widthCycle.length]}%`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </SkeletonRegion>
  );
}

/// Mirrors one `.ae-dash-stat` tile (DashboardPage.tsx) - a big number over
/// a label, same padding/proportions as the real StatCard so the four
/// tiles don't visibly resize once real numbers land.
export function StatCardSkeleton() {
  return (
    <div className="ae-dash-stat" aria-hidden="true" style={{ pointerEvents: "none" }}>
      <Skeleton height={28} width="60%" radius={5} style={{ marginBottom: 10 }} />
      <Skeleton height={11} width="80%" />
    </div>
  );
}

// No wrapping element (a grid's direct children have to stay actual grid
// items) - the caller wraps its own `.ae-dash-stats` grid container with
// `aria-busy`/`role="status"` while this is showing, see DashboardPage.tsx.
export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </>
  );
}

/// A handful of pill-shaped row placeholders - for card sections whose real
/// content is a short list of action rows/links (DashboardPage's "Today")
/// rather than a full data table.
export function RowsSkeleton({ rows = 3, height = 20, label = "Loading…" }: { rows?: number; height?: number; label?: string }) {
  return (
    <SkeletonRegion label={label} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} width={i === rows - 1 ? "55%" : "100%"} />
      ))}
    </SkeletonRegion>
  );
}

/// Mirrors MonthlyMonitoring's bar chart - a row of bars at varied
/// (deterministic, not random-per-render) heights plus a month-label bar
/// under each, so the loading state occupies the exact footprint the real
/// chart will fill in at rather than collapsing the section to nothing.
export function BarsSkeleton({ count = 12, chartHeight = 130 }: { count?: number; chartHeight?: number }) {
  const heightCycle = [40, 65, 50, 80, 55, 70, 45, 90, 60, 75, 50, 68];
  return (
    <SkeletonRegion label="Loading monthly monitoring…" style={{ padding: "20px 20px 8px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: chartHeight }}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
            <div style={{ flex: 1, display: "flex", alignItems: "flex-end", width: "100%" }}>
              <Skeleton width="100%" height={`${heightCycle[i % heightCycle.length]}%`} style={{ maxWidth: 26, margin: "0 auto" }} />
            </div>
            <Skeleton height={9} width={22} style={{ marginTop: 6 }} />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}
