// System Log entries for desktop updates that couldn't be sent yet.
//
// The updater (updater.ts) can finish installing before anyone is signed in
// (it runs at launch, straight from main.tsx), or while the server is
// unreachable - POSTing then either 401s or is lost, and the update would
// never show up in the System Log. So the entry is queued here first (survives
// the relaunch) and sent once there's a signed-in session: Layout.tsx flushes
// the queue on mount, and updater.ts tries it right away when it can.
import { ApiError, getToken, QueuedOfflineError } from "../api/http";
import { recordSystemLog } from "../api/systemLog";

const KEY = "ae:pending-system-log";

interface PendingSystemLog {
  event: string;
  fromVersion: string;
  toVersion: string;
}

const same = (a: PendingSystemLog, b: PendingSystemLog) =>
  a.event === b.event && a.fromVersion === b.fromVersion && a.toVersion === b.toVersion;

function read(): PendingSystemLog[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list: PendingSystemLog[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable - nothing more to do; the entry is best effort.
  }
}

export function queueSystemLog(entry: PendingSystemLog) {
  const list = read();
  if (!list.some((p) => same(p, entry))) write([...list, entry]);
}

let flushing = false;

/// Sends every queued entry. Does nothing without a signed-in session (a
/// tokenless request would 401 and trip the app's session-expired handling).
export async function flushPendingSystemLog(): Promise<void> {
  if (flushing || !getToken()) return;
  flushing = true;
  try {
    for (const entry of read()) {
      try {
        await recordSystemLog(entry);
      } catch (err) {
        // Offline: http.ts already moved it into the generic offline outbox,
        // which sends it on reconnect - so it's no longer ours to keep.
        // A 400 can never succeed, so retrying it forever would be pointless.
        const handedOff = err instanceof QueuedOfflineError || (err instanceof ApiError && err.status === 400);
        if (!handedOff) {
          console.error("Failed to record system log entry - will retry next launch", err);
          continue;
        }
      }
      write(read().filter((p) => !same(p, entry)));
    }
  } finally {
    flushing = false;
  }
}