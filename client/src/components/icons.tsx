import { useId } from "react";
import {
  ArrowDownUp,
  ArrowUp,
  ArrowUpFromLine,
  Ban,
  Calculator,
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
  EllipsisVertical,
  FileChartColumnIncreasing,
  History,
  Keyboard,
  Layers,
  LayoutDashboard,
  Lock,
  Moon,
  Package,
  Play,
  Printer,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sun,
  Tag,
  TriangleAlert,
  Truck,
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

/// The AI's colours: the four of Google's AI search, used as a gradient on the spark and as the ring
/// around the search (styles/toolbar-alignment.css uses the same four).
const AI_STOPS = [
  ["0%", "#4285f4"],
  ["38%", "#ea4335"],
  ["68%", "#fbbc04"],
  ["100%", "#34a853"],
] as const;

/// A four-point spark filled with the AI gradient. Each instance gets its own gradient id so two on
/// one page never share (or lose) a definition.
function AiSpark({ x, y, scale, className }: { x: number; y: number; scale: number; className?: string }) {
  const id = `ae-ai-grad-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {AI_STOPS.map(([offset, color]) => (
            <stop key={offset} offset={offset} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      <g transform={`translate(${x} ${y}) scale(${scale})`}>
        <path
          className={className}
          fill={`url(#${id})`}
          d="M0 -5 Q0.9 -0.9 5 0 Q0.9 0.9 0 5 Q-0.9 0.9 -5 0 Q-0.9 -0.9 0 -5 Z"
        />
      </g>
    </>
  );
}

/// Whether the person asked their system for less motion. Read once when the icon mounts: the
/// gradient below is animated by SVG itself, which CSS's prefers-reduced-motion rule cannot reach.
const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/// The header search icon when the AI is available: an open-ring magnifier with a four-point spark
/// beside it, both drawn in the AI gradient, and the gradient drifts slowly along the
/// icon (one colour cycle every 8 seconds; still with reduced motion). The spark also twinkles
/// (.ae-ai-spark in styles/toolbar-alignment.css). Decorative - the button carries the label.
export function AiSearchIcon() {
  const id = `ae-ai-search-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const still = prefersReducedMotion();
  return (
    <svg className="ae-ai-search-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <defs>
        {/* userSpaceOnUse + repeat: one cycle spans 24 units, so sliding it by exactly 24 loops seamlessly. */}
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="24" y2="0" spreadMethod="repeat">
          <stop offset="0%" stopColor="#4285f4" />
          <stop offset="25%" stopColor="#ea4335" />
          <stop offset="50%" stopColor="#fbbc04" />
          <stop offset="75%" stopColor="#34a853" />
          <stop offset="100%" stopColor="#4285f4" />
          {!still && <animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="24 0" dur="8s" repeatCount="indefinite" />}
        </linearGradient>
      </defs>
      {/* An open ring - 270 degrees, the top-right quarter left clear - with the handle leaving it at the
          bottom right and the spark sitting in the gap, outside the lens. */}
      <path d="M10.4 8.2 A4.2 4.2 0 1 1 6.2 4" stroke={`url(#${id})`} strokeWidth="1.1" strokeLinecap="round" />
      <path d="M9.2 11.2 L12.6 14.6" stroke={`url(#${id})`} strokeWidth="1.1" strokeLinecap="round" />
      <g transform="translate(11.9 4) scale(0.62)">
        <path className="ae-ai-spark" fill={`url(#${id})`} d="M0 -5 Q0.6 -0.6 5 0 Q0.6 0.6 0 5 Q-0.6 0.6 -5 0 Q-0.6 -0.6 0 -5 Z" />
      </g>
    </svg>
  );
}

/// The spark alone, for the "Ask AI" row in the search palette.
export function SparklesIcon() {
  return (
    <svg width="14" height="14" viewBox="-6 -6 12 12" fill="none" aria-hidden="true">
      <AiSpark x={0} y={0} scale={1} />
    </svg>
  );
}

export function KeyboardIcon() {
  return <Keyboard {...look(15, 1.6)} />;
}

export function CalculatorIcon() {
  return <Calculator {...look(15, 1.6)} />;
}

export function SunIcon() {
  return <Sun {...look(15, 1.6)} />;
}

export function MoonIcon() {
  return <Moon {...look(15, 1.6)} />;
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

/// Three dots stacked vertically: the phone bottom nav's layout switch.
export function EllipsisVerticalIcon() {
  return <EllipsisVertical {...look(18, 1.8)} />;
}

export function LockIcon({ size = 16 }: { size?: number }) {
  return <Lock {...look(size, 1.5)} />;
}

/// Publish: an arrow leaving a line (a count released to the next shift). Not
/// Upload, which is already the Export icon on the same toolbar.
export function PublishIcon() {
  return <ArrowUpFromLine {...look(16, 1.6)} />;
}

/// The phone's bottom navigation bar (PhoneBottomNav.tsx): one per page, larger than the toolbar
/// icons because each stands above a one-word label as the main thing to aim a thumb at.
const nav = { size: 21, strokeWidth: 1.7, "aria-hidden": true as const };

export function NavDashboardIcon() {
  return <LayoutDashboard {...nav} />;
}

export function NavReportIcon() {
  return <FileChartColumnIncreasing {...nav} />;
}

export function NavStocksIcon() {
  return <Layers {...nav} />;
}

export function NavOutIcon() {
  return <Truck {...nav} />;
}

export function NavLogIcon() {
  return <History {...nav} />;
}

export function NavSettingsIcon() {
  return <Settings {...nav} />;
}
