import { HttpError } from "./HttpError";

/// Normalizes a "YYYY-MM-DD" query/body value into a UTC midnight Date, the
/// shape Prisma expects for a @db.Date column.
export function parseDateOnly(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw HttpError.badRequest('Expected a date in "YYYY-MM-DD" format');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw HttpError.badRequest("Invalid date");
  return date;
}

export function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
