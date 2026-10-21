import {
  ArrowDownUp,
  ArrowUp,
  ArrowUpFromLine,
  Ban,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FoldHorizontal,
  Clock,
  Download,
  Ellipsis,
  FileChartColumnIncreasing,
  History,
  Layers,
  Lock,
  MapPin,
  Moon,
  Package,
  Pin,
  Play,
  Printer,
  RefreshCw,
  Save,
  Search,
  Sun,
  Tag,
  TriangleAlert,
  Undo2,
  UnfoldHorizontal,
  Upload,
  X,
  ZoomIn,
  createLucideIcon,
} from "lucide-react";

/// Toolbar and card icons - thin wrappers around Lucide (named imports only, so
/// unused icons are tree-shaken). Every export keeps the name, props and size of
/// the hand-drawn SVG it replaced, so no caller changes. currentColor (Lucide's
/// default stroke) so they inherit whatever text color the surrounding
/// button/segment uses, in both themes. Decorative: aria-hidden, since each sits
/// next to a text label or inside a button that carries its own aria-label.

/// The old icons were drawn on a 16-unit grid with their own stroke width;
/// Lucide's grid is 24. `absoluteStrokeWidth` makes strokeWidth a pixel width
/// instead of a grid unit, so passing the old width scaled to the rendered size
/// (width * size / 16) keeps each icon exactly as heavy as it was.
const look = (size: number, oldStroke: number) => ({
  size,
  strokeWidth: (oldStroke * size) / 16,
  absoluteStrokeWidth: true,
  "aria-hidden": true as const,
});

export function DownloadIcon() {
  return <Download {...look(14, 1.6)} />;
}

export function UploadIcon() {
  return <Upload {...look(14, 1.6)} />;
}

export function UndoIcon() {
  return <Undo2 {...look(15, 1.7)} />;
}

/// Discards unsaved staged edits (Section 3.1's "Clear" toolbar action, next
/// to Save) - distinct from UndoIcon (which reverts an already-committed save)
/// since clearing never touches the server.
export function ClearIcon() {
  return <X {...look(14, 1.5)} />;
}

export function SearchIcon() {
  return <Search {...look(13, 1.6)} />;
}

export function SunIcon() {
  return <Sun {...look(15, 1.6)} />;
}

export function MoonIcon() {
  return <Moon {...look(15, 1.6)} />;
}

export function PinIcon({ filled = false }: { filled?: boolean }) {
  return <Pin {...look(14, 1.5)} fill={filled ? "currentColor" : "none"} />;
}

export function ArrowUpIcon() {
  return <ArrowUp {...look(16, 1.8)} />;
}

export function SaveIcon() {
  return <Save {...look(14, 1.5)} />;
}

/// Points down; rotate via CSS on the caller's side to show collapsed (right) vs
/// expanded (down) - used on category header rows (StockGrid, TotalStocksTable)
/// to expand/collapse that category's product rows.
export function ChevronIcon() {
  return <ChevronDown {...look(12, 2)} />;
}

export function PrinterIcon() {
  return <Printer {...look(14, 1.5)} />;
}

export function ReportIcon() {
  return <FileChartColumnIncreasing {...look(14, 1.5)} />;
}

export function CalendarIcon() {
  return <Calendar {...look(15, 1.5)} />;
}

export function ChevronLeftIcon() {
  return <ChevronLeft {...look(14, 2)} />;
}

export function ChevronRightIcon() {
  return <ChevronRight {...look(14, 2)} />;
}

/// Dashboard stat-card icons.
export function TagIcon() {
  return <Tag {...look(16, 1.4)} />;
}

export function BoxIcon() {
  return <Package {...look(16, 1.4)} />;
}

export function LayersIcon() {
  return <Layers {...look(16, 1.4)} />;
}

export function AlertTriangleIcon() {
  return <TriangleAlert {...look(16, 1.4)} />;
}

export function ClockIcon() {
  return <Clock {...look(15, 1.5)} />;
}

export function HistoryIcon() {
  return <History {...look(14, 1.6)} />;
}

export function PlayIcon() {
  return <Play {...look(13, 1.2)} fill="currentColor" />;
}

export function ZoomIcon() {
  return <ZoomIn {...look(14, 1.6)} />;
}

export function MapPinIcon() {
  return <MapPin {...look(14, 1.5)} />;
}

export function SyncIcon() {
  return <RefreshCw {...look(16, 1.6)} />;
}

export function CheckIcon() {
  return <Check {...look(16, 1.8)} />;
}

/// Collapse every category (StockGrid's page-level toolbar button): chevrons
/// pointing in toward each other.
export function CollapseAllIcon() {
  return <ChevronsDownUp {...look(15, 1.7)} />;
}

/// Expand every category: chevrons pointing out, away from each other.
export function ExpandAllIcon() {
  return <ChevronsUpDown {...look(15, 1.7)} />;
}

/// Stretch a table's columns to fill the width: arrows pointing out to both sides.
export function FitWidthIcon() {
  return <UnfoldHorizontal {...look(15, 1.7)} />;
}

/// Put a stretched table back to content-sized columns: arrows pointing in.
export function CompactWidthIcon() {
  return <FoldHorizontal {...look(15, 1.7)} />;
}

/// Arrange product order: an up arrow beside a down arrow.
export function ReorderIcon() {
  return <ArrowDownUp {...look(15, 1.6)} />;
}

/// Lucide has no padlock with a check, so this is its own Lock drawing (the same
/// body and shackle) with a check inside the body, built with Lucide's own icon
/// builder so it takes the same props and stroke as every other icon here.
const LockCheck = createLucideIcon("lock-check", [
  ["rect", { width: "18", height: "11", x: "3", y: "11", rx: "2", ry: "2", key: "body" }],
  ["path", { d: "M7 11V7a5 5 0 0 1 10 0v4", key: "shackle" }],
  ["path", { d: "m9.5 16.5 1.8 1.8 3.4-3.6", key: "check" }],
]);

/// "Lock this" - the Finish day / Finish pending days buttons, which lock a sheet.
export function LockCheckIcon({ size = 16 }: { size?: number }) {
  return <LockCheck {...look(size, 1.6)} />;
}

/// A circle with a slash: the "not available right now" mark on a disabled menu
/// item, so being disabled is never shown by dimming alone.
export function BanIcon() {
  return <Ban {...look(14, 1.6)} />;
}

/// "More actions" - the overflow menu's trigger.
export function EllipsisIcon() {
  return <Ellipsis {...look(18, 1.8)} />;
}

export function LockIcon({ size = 16 }: { size?: number }) {
  return <Lock {...look(size, 1.5)} />;
}

/// Publish: an arrow leaving a line (a count released to the next shift). Not
/// Upload, which is already the Export icon on the same toolbar.
export function PublishIcon() {
  return <ArrowUpFromLine {...look(16, 1.6)} />;
}
