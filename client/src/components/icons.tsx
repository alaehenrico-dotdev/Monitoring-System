/// Small inline icons for toolbar buttons - kept as plain SVG (no icon
/// library) since only a handful are needed. currentColor so they inherit
/// whatever text color the surrounding button/segment uses.

export function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2v7.5M8 9.5L5 6.5M8 9.5l3-3M2.5 11v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}

export function UploadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 9.5V2M8 2L5 5M8 2l3 3M2.5 11v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}

export function UndoIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.5 4 2.5 7l3 3" />
      <path d="M3 7h6.5a4 4 0 0 1 4 4v1" />
    </svg>
  );
}

/// Discards unsaved staged edits (Section 3.1's "Clear" toolbar action, next
/// to Save) - a plain trash can, distinct from UndoIcon (which reverts an
/// already-committed save) since clearing never touches the server.
export function ClearIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5v9a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-9" />
      <path d="M6.7 7.2v4M9.3 7.2v4" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.3 10.3 14 14" />
    </svg>
  );
}

export function SunIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="3.2" />
      <path d="M8 1.2v1.6M8 13.2v1.6M2.5 8H1M15 8h-1.5M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13.5 9.8A5.8 5.8 0 0 1 6.2 2.5a5.8 5.8 0 1 0 7.3 7.3Z" />
    </svg>
  );
}

export function PinIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 1.5 14.5 6.5 12 9l-2.5 5-1-1-3-3-1-1 5-2.5 2.5-2.5Z" />
      <path d="M6.5 9.5 2 14" />
    </svg>
  );
}

export function ArrowUpIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
    </svg>
  );
}

export function SaveIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 2.5h9l2 2v9a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" />
      <path d="M4.5 2.5v3.5h5V2.5" />
      <path d="M4.5 14v-4.5h7V14" />
    </svg>
  );
}

/// Points right when collapsed, down when expanded (rotate via CSS on the
/// caller's side) - used on category header rows (StockGrid, TotalStocksTable)
/// to expand/collapse that category's product rows.
export function ChevronIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 6.5 8 10l3.5-3.5" />
    </svg>
  );
}

export function PrinterIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 6V2.5h7V6" />
      <rect x="2" y="6" width="12" height="6" rx="1" />
      <path d="M4.5 11.5h7V14h-7z" />
    </svg>
  );
}

export function ReportIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 1.5h5.5L13 5v9.5H4z" />
      <path d="M9.5 1.5V5H13" />
      <path d="M6 8.5h5M6 11h5" />
    </svg>
  );
}

export function CalendarIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3.5" width="12" height="11" rx="1.5" />
      <path d="M5 1.5v3M11 1.5v3M2 6.5h12" />
    </svg>
  );
}

export function ChevronLeftIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </svg>
  );
}

export function ChevronRightIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

/// Dashboard stat-card icons - a small set matching this file's own stroke
/// style (viewBox 0 0 16 16, currentColor, rounded caps/joins) rather than
/// a general-purpose icon library, since only these few are needed.
export function TagIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8.7 1.5H3.5a1 1 0 0 0-1 1v5.2a1 1 0 0 0 .3.7l6.1 6.1a1 1 0 0 0 1.4 0l5.2-5.2a1 1 0 0 0 0-1.4l-6.1-6.1a1 1 0 0 0-.7-.3Z" />
      <circle cx="5.7" cy="4.7" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BoxIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 5.2 8 2l6 3.2v5.6L8 14 2 10.8V5.2Z" />
      <path d="M2 5.2 8 8.4l6-3.2M8 8.4V14" />
    </svg>
  );
}

export function LayersIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1.5 14 5 8 8.5 2 5l6-3.5Z" />
      <path d="M2 8 8 11.5 14 8M2 11l6 3.5L14 11" />
    </svg>
  );
}

export function AlertTriangleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1.8 14.8 13.5a1 1 0 0 1-.86 1.5H2.06a1 1 0 0 1-.86-1.5L8 1.8Z" />
      <path d="M8 6.2v3.2" />
      <circle
        cx="8"
        cy="11.8"
        r="0.15"
        fill="currentColor"
        stroke="currentColor"
      />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.3 1.5" />
    </svg>
  );
}

export function HistoryIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4M2.5 2.5v3h3" />
      <path d="M8 5.2V8l2 1.3" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    >
      <path d="M4.5 2.8v10.4a.5.5 0 0 0 .76.43l8.3-5.2a.5.5 0 0 0 0-.86l-8.3-5.2a.5.5 0 0 0-.76.43Z" />
    </svg>
  );
}

export function ZoomIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.3 10.3 14 14M5.2 7h3.6M7 5.2v3.6" />
    </svg>
  );
}

export function MapPinIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 14.5s4.5-4.1 4.5-7.8a4.5 4.5 0 0 0-9 0C3.5 10.4 8 14.5 8 14.5Z" />
      <circle cx="8" cy="6.7" r="1.6" />
    </svg>
  );
}