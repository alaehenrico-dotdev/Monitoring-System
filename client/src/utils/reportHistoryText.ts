import type { ReportHistoryEntry } from "../api/reportHistory";
import { SHIFT_SHORT_LABELS } from "./shift";

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDay(value: string): Date | null {
  const m = ISO_DAY.exec(value.trim());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export const fullDate = (d: Date) =>
  d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
const shortDate = (d: Date, withYear: boolean) =>
  d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });

/// Turns an entry's stored scope ("2026-09-27" or "2026-09-01 to 2026-09-07")
/// into a readable title, a small detail chip, and the category filter the
/// Variance Report was run with (only present in the saved route's query).
export function describe(entry: ReportHistoryEntry): {
  title: string;
  detail: string;
  category: string;
} {
  if (entry.type === "Audit Report") return describeAudit(entry);
  let category = "";
  try {
    category =
      new URL(entry.route, "http://x").searchParams.get("category") ?? "";
  } catch {
    // Malformed route - just skip the category chip.
  }

  const single = parseDay(entry.scope);
  if (single) return { title: fullDate(single), detail: "1 day", category };

  const [from, to] = entry.scope.split(" to ").map((part) => parseDay(part));
  if (from && to) {
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    const sameYear = from.getFullYear() === to.getFullYear();
    return {
      title: `${shortDate(from, !sameYear)} – ${shortDate(to, true)}`,
      detail: `${days} ${days === 1 ? "day" : "days"}`,
      category,
    };
  }
  return { title: entry.scope, detail: "", category };
}

/// An Audit (Manual Counting & Variance) report is one date + shift + source
/// view, so the shift and the Online/Offline filter - which only live in the
/// saved route's query - become the two chips.
const AUDIT_SOURCE_LABEL: Record<string, string> = {
  TOTAL: "Online + Offline",
  ONLINE: "Online",
  OFFLINE: "Offline",
};

function describeAudit(entry: ReportHistoryEntry): {
  title: string;
  detail: string;
  category: string;
} {
  let shift = "";
  let source = "";
  try {
    const params = new URL(entry.route, "http://x").searchParams;
    shift =
      SHIFT_SHORT_LABELS[params.get("shift") as "MORNING" | "NIGHT"] ?? "";
    source = AUDIT_SOURCE_LABEL[params.get("source") ?? ""] ?? "";
  } catch {
    // Malformed route - just skip the chips.
  }
  const day = parseDay(entry.scope);
  return {
    title: day ? fullDate(day) : entry.scope,
    detail: shift ? `${shift} shift` : "",
    category: source,
  };
}

