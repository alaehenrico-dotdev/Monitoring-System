import type { ChangeLogEntry } from "../types";
import { colors } from "../theme";

/// Single source of truth for how a change_log row's raw `tableName` reads
/// on screen - shared by ChangeLogPage (Section 4.8) and the Dashboard's
/// recent-activity feed, so the same table is never labeled two different
/// ways depending on which page you're looking at.
export const TABLE_LABELS: Record<string, string> = {
  daily_online_stock: "Online Stock",
  daily_offline_stock: "Offline Stock",
  manual_counts: "Manual Count",
  products: "SKUs",
  receipts: "Receipts",
};

export const ACTION_COLOR: Record<ChangeLogEntry["action"], string> = {
  CREATE: colors.warningText,
  UPDATE: colors.ink,
  DELETE: colors.danger,
};
