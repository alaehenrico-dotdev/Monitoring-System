import { env } from "../config/env";
import { purgeExpiredIdempotencyKeys } from "../middleware/idempotency";
import { runArchive } from "./changeLogArchive.service";

const DAY_MS = 24 * 60 * 60 * 1000;

/// Nightly housekeeping that keeps the hot tables small: archive old change-log
/// rows and drop expired idempotency keys. Failures are logged, never thrown -
/// housekeeping must not take the API down.
export async function runMaintenance(): Promise<void> {
  try {
    await purgeExpiredIdempotencyKeys();
    if (env.changeLogRetentionMonths > 0) await runArchive(env.changeLogRetentionMonths);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "maintenance-failed", message: err instanceof Error ? err.message : String(err) }));
  }
}

export function startMaintenance(): () => void {
  // First pass a few minutes after boot (not during it), then daily.
  const first = setTimeout(() => void runMaintenance(), 5 * 60 * 1000);
  const daily = setInterval(() => void runMaintenance(), DAY_MS);
  first.unref();
  daily.unref();
  return () => {
    clearTimeout(first);
    clearInterval(daily);
  };
}
