import { Select } from "./ui";
import { colors } from "../theme";

const PAGE_SIZES = [10, 20, 50, 100] as const;

/**
 * "Showing 21–30 of 160 records · Rows per page [10] · « ‹ 3 / 16 ›".
 *
 * The step buttons are borderless (hover tint only, .ae-pager-btn); the rows
 * selector keeps the app's normal field look. Hidden when everything fits on
 * the smallest page size, since there is nothing to page.
 */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  pageSizes = PAGE_SIZES,
  loading = false,
  compact = false,
  label = "Pagination",
}: {
  /// 1-based.
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  /// Omit to hide the "Rows per page" selector.
  onPageSize?: (size: number) => void;
  pageSizes?: readonly number[];
  /// A page is being fetched: the controls are held.
  loading?: boolean;
  /// Tighter spacing, for a category header row.
  compact?: boolean;
  label?: string;
}) {
  if (total <= Math.min(...pageSizes)) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);
  const atStart = current <= 1;
  const atEnd = current >= pageCount;
  const strong = { color: colors.ink, fontWeight: 700 } as const;

  return (
    <nav
      aria-label={label}
      className="ae-pager no-print"
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        justifyContent: compact ? "flex-end" : "center",
        gap: compact ? "4px 14px" : "8px 20px",
        marginTop: compact ? 0 : 12,
        fontSize: compact ? 12 : 13,
        color: colors.subtleInk,
      }}
    >
      <span aria-live="polite">
        Showing <span style={strong}>{from.toLocaleString()}–{to.toLocaleString()}</span> of{" "}
        <span style={strong}>{total.toLocaleString()}</span> records
      </span>
      {onPageSize && (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          Rows per page:
          <Select
            aria-label="Rows per page"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            style={{ width: "auto" }}
          >
            {pageSizes.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </Select>
        </label>
      )}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
        <button type="button" className="ae-pager-btn" aria-label="First page" disabled={atStart || loading} onClick={() => onPage(1)}>
          «
        </button>
        <button type="button" className="ae-pager-btn" aria-label="Previous page" disabled={atStart || loading} onClick={() => onPage(current - 1)}>
          ‹
        </button>
        <span style={{ minWidth: 56, textAlign: "center", color: colors.subtleInk }}>
          <span style={strong}>{current}</span> / {pageCount.toLocaleString()}
        </span>
        <button type="button" className="ae-pager-btn" aria-label="Next page" disabled={atEnd || loading} onClick={() => onPage(current + 1)}>
          ›
        </button>
      </span>
    </nav>
  );
}
