import { http } from "./http";
import type { Shift } from "../types";
import { extraColumnKey } from "../hooks/useExtraColumns";

export type ExtraLabelLocation = "ONLINE" | "OFFLINE";

export interface ExtraLabel {
  columnKey: string;
  slotIndex: number;
  label: string;
}

export function getExtraLabels(location: ExtraLabelLocation, date: string, shift: Shift) {
  return http.get<ExtraLabel[]>(`/extra-labels?location=${location}&date=${date}&shift=${shift}`);
}

/// A blank label clears the name.
export function saveExtraLabel(data: {
  location: ExtraLabelLocation;
  date: string;
  shift: Shift;
  columnKey: string;
  slotIndex: number;
  label: string;
}) {
  return http.put<{ label: string }>("/extra-labels", data);
}

export interface DayExtraNames {
  ONLINE: Record<string, string>;
  OFFLINE: Record<string, string>;
}

/// The names typed into a day's added columns, for the Daily Report and the
/// End-of-Day pack. Names belong to one shift's sheet, but the report lays both
/// shifts out together, so a slot named differently on each shows both ("Route A / Route B").
/// Best effort: a failed lookup just leaves the generic "+1" labels.
export async function getDayExtraNames(date: string): Promise<DayExtraNames> {
  const out: DayExtraNames = { ONLINE: {}, OFFLINE: {} };
  const shifts: Shift[] = ["MORNING", "NIGHT"];
  for (const location of ["ONLINE", "OFFLINE"] as const) {
    const lists = await Promise.all(shifts.map((s) => getExtraLabels(location, date, s).catch(() => [] as ExtraLabel[])));
    for (const rows of lists) {
      for (const r of rows) {
        const key = extraColumnKey(r.columnKey, r.slotIndex);
        const have = out[location][key];
        if (!have) out[location][key] = r.label;
        else if (!have.split(" / ").includes(r.label)) out[location][key] = `${have} / ${r.label}`;
      }
    }
  }
  return out;
}
