import { Shift, StockLocation } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/HttpError";
import { toDateOnlyString } from "../utils/date";
import { EXTRA_COLUMNS, extraCellKey, MAX_EXTRAS_PER_COLUMN } from "../utils/stockExtras";
import { assertEarlierDaysFinished, assertPeriodOpen } from "./dayLock.service";
import { logSystemEvent } from "./changeLog.service";

export const MAX_LABEL_LENGTH = 60;

type GridLocation = "ONLINE" | "OFFLINE";

export async function listExtraLabels(location: GridLocation, entryDate: Date, shift: Shift) {
  const rows = await prisma.extraColumnLabel.findMany({
    where: { location: location as StockLocation, entryDate, shift },
    select: { columnKey: true, slotIndex: true, label: true },
  });
  return rows;
}

export interface DayExtraNames {
  ONLINE: Record<string, string>;
  OFFLINE: Record<string, string>;
}

/// The names typed into a day's added columns, for the Daily Report and its PDF.
/// A name belongs to one shift's sheet, but the report lays both shifts out
/// together, so a slot named differently on each shows both ("Route A / Route B"),
/// Morning first. Keyed by `extraCellKey` (the column's key in a report row).
export async function getDayExtraNames(entryDate: Date): Promise<DayExtraNames> {
  const rows = await prisma.extraColumnLabel.findMany({
    where: { entryDate },
    select: { location: true, shift: true, columnKey: true, slotIndex: true, label: true },
  });
  const out: DayExtraNames = { ONLINE: {}, OFFLINE: {} };
  const order = (s: string) => (s === "MORNING" ? 0 : 1);
  for (const r of [...rows].sort((a, b) => order(a.shift) - order(b.shift))) {
    if (r.location !== "ONLINE" && r.location !== "OFFLINE") continue;
    const key = extraCellKey(r.columnKey, r.slotIndex);
    const have = out[r.location][key];
    if (!have) out[r.location][key] = r.label;
    else if (!have.split(" / ").includes(r.label)) out[r.location][key] = `${have} / ${r.label}`;
  }
  return out;
}

/**
 * Sets (or, for a blank name, clears) one added column's header name. Refused
 * on a finished/closed day like any other entry edit, and recorded in the
 * Change Log so a rename is traceable.
 */
export async function saveExtraLabel(
  input: { location: GridLocation; entryDate: Date; shift: Shift; columnKey: string; slotIndex: number; label: string },
  userId?: number,
) {
  const { location, entryDate, shift, columnKey, slotIndex } = input;
  if (!EXTRA_COLUMNS[location].includes(columnKey)) {
    throw HttpError.badRequest(`"${columnKey}" cannot have added columns`);
  }
  if (slotIndex < 1 || slotIndex > MAX_EXTRAS_PER_COLUMN) throw HttpError.badRequest("Invalid column slot");
  const label = input.label.trim().replace(/\s+/g, " ");
  if (label.length > MAX_LABEL_LENGTH) throw HttpError.badRequest(`Names are at most ${MAX_LABEL_LENGTH} characters`);

  await assertPeriodOpen(entryDate, shift, undefined, "entry", location);
  await assertEarlierDaysFinished(entryDate, undefined, location);
  const where = {
    location_entryDate_shift_columnKey_slotIndex: { location: location as StockLocation, entryDate, shift, columnKey, slotIndex },
  };
  const existing = await prisma.extraColumnLabel.findUnique({ where });
  if ((existing?.label ?? "") === label) return { label };

  if (label === "") await prisma.extraColumnLabel.delete({ where });
  else {
    await prisma.extraColumnLabel.upsert({
      where,
      create: { location: location as StockLocation, entryDate, shift, columnKey, slotIndex, label, updatedById: userId ?? null },
      update: { label, updatedById: userId ?? null },
    });
  }
  await logSystemEvent(
    "extra_column_label",
    { location, date: toDateOnlyString(entryDate), shift, columnKey, slotIndex, from: existing?.label ?? null, to: label || null },
    userId ?? null,
    existing ? (label ? "UPDATE" : "DELETE") : "CREATE",
  );
  return { label };
}
