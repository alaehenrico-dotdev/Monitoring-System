/**
 * A one-way notice that a day's Daily Report has just been saved (a day was
 * finished, or a correction re-saved a frozen one). Whoever cares - today the
 * Google Drive upload - registers a handler; the services that save reports only
 * call `notifyDailyReportSaved`, so they never import Drive code (and its
 * environment needs) just to say "this changed".
 *
 * Always called after the saving transaction has committed, and a handler that
 * throws can never fail the save.
 */
type Handler = (entryDate: Date) => void;

let handler: Handler | null = null;

export function setReportSavedHandler(next: Handler | null): void {
  handler = next;
}

export function notifyDailyReportSaved(entryDate: Date): void {
  try {
    handler?.(entryDate);
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", event: "report-saved-handler-failed", message: err instanceof Error ? err.message : String(err) }));
  }
}
