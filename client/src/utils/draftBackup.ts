/**
 * Crash/close-proof copy of the staged-but-unsaved edits.
 *
 * The entry pages keep in-progress work in sessionStorage (see
 * hooks/usePendingEntryChanges.ts and pages/ManualCountPage.tsx). That
 * survives navigation and a page reload, but not closing the tab or the
 * desktop window, a crash, or a power cut. This module mirrors those same
 * keys into localStorage and puts them back the next time the same person
 * signs in - the pages themselves are untouched, they simply find their
 * drafts in sessionStorage again, exactly as if the tab had never closed.
 *
 * Rules that keep this from ever doing damage:
 *  - A backup is only restored for the user who made it.
 *  - A backup is only restored into a tab that has no staged edits of its
 *    own for that key (never overwrites newer work).
 *  - A backup owned by a tab that is still open (recent heartbeat) is left
 *    alone, so two open tabs don't steal each other's drafts.
 *  - Backups older than a week are dropped.
 *  - Saving, discarding, logging out and Data Reset all remove the staged
 *    edits from sessionStorage; the next sync (or clearDraftBackups) removes
 *    the matching backup, so already-saved work is not resurrected.
 *
 * Restored edits keep their baselines, so the pages' existing conflict
 * detection still flags anything someone else changed in the meantime.
 */
import { ENTRY_PREFIX, MANUAL_COUNT_PREFIX } from "./unsavedWork";

// Must stay in sync with the keys those pages/hooks write (see the header of
// utils/unsavedWork.ts for the same note).
const BASELINE_PREFIX = "ala-eh-baseline:";
const EXTRA_COLUMNS_PREFIX = "ala-eh-extracols:";
const TRACKED_PREFIXES = [
  ENTRY_PREFIX,
  MANUAL_COUNT_PREFIX,
  BASELINE_PREFIX,
  EXTRA_COLUMNS_PREFIX,
];

const BACKUP_PREFIX = "ala-eh-draft-bak:";
const ALIVE_PREFIX = "ala-eh-tab-alive:";
const TAB_ID_KEY = "ala-eh-tab-id";
/// Owner value for backups parked by a deliberate log out - no tab is "alive"
/// under this id, so the same user's next sign-in restores them.
const PARKED = "parked";

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/// A tab counts as open if it wrote its heartbeat this recently.
const ALIVE_WINDOW_MS = 20_000;

interface Backup {
  value: string;
  uid: number;
  tab: string;
  at: number;
}

function isTracked(key: string): boolean {
  return TRACKED_PREFIXES.some((p) => key.startsWith(p));
}

function tabId(): string {
  try {
    let id = sessionStorage.getItem(TAB_ID_KEY);
    if (!id) {
      id = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      sessionStorage.setItem(TAB_ID_KEY, id);
    }
    return id;
  } catch {
    return "no-session-storage";
  }
}

function readBackup(raw: string | null): Backup | null {
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as Partial<Backup>;
    if (
      typeof b.value !== "string" ||
      typeof b.uid !== "number" ||
      typeof b.tab !== "string" ||
      typeof b.at !== "number"
    )
      return null;
    return b as Backup;
  } catch {
    return null;
  }
}

function sessionKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k && isTracked(k)) keys.push(k);
  }
  return keys;
}

function backupKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(BACKUP_PREFIX)) keys.push(k);
  }
  return keys;
}

function isTabAlive(tab: string, now: number): boolean {
  const beat = Number(localStorage.getItem(ALIVE_PREFIX + tab));
  return Number.isFinite(beat) && beat > 0 && now - beat < ALIVE_WINDOW_MS;
}

/**
 * Mirrors this tab's staged edits into localStorage, and removes the backups
 * of edits that are no longer staged (saved or discarded). Cheap - a handful
 * of small keys - so it is safe to call every second and on page hide.
 * Best effort: blocked or full storage just means no backup, never an error.
 */
export function syncDraftBackup(userId: number): void {
  try {
    const me = tabId();
    const now = Date.now();
    localStorage.setItem(ALIVE_PREFIX + me, String(now));

    const live = new Set<string>();
    for (const key of sessionKeys()) {
      const value = sessionStorage.getItem(key);
      if (value === null) continue;
      live.add(key);
      const existing = readBackup(localStorage.getItem(BACKUP_PREFIX + key));
      if (
        existing &&
        existing.value === value &&
        existing.tab === me &&
        existing.uid === userId
      )
        continue;
      const next: Backup = { value, uid: userId, tab: me, at: now };
      localStorage.setItem(BACKUP_PREFIX + key, JSON.stringify(next));
    }

    // Edits this tab no longer has staged were saved or discarded - their
    // backup must go too. Backups owned by other tabs (or parked) stay put.
    for (const k of backupKeys()) {
      if (live.has(k.slice(BACKUP_PREFIX.length))) continue;
      const b = readBackup(localStorage.getItem(k));
      if (!b || b.tab === me) localStorage.removeItem(k);
    }

    // Heartbeats of tabs that closed long ago.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(ALIVE_PREFIX)) continue;
      if (now - Number(localStorage.getItem(k)) > MAX_AGE_MS)
        localStorage.removeItem(k);
    }
  } catch {
    // Best effort.
  }
}

/// Marks this tab as closed, so a tab opened right afterwards can restore its
/// backups immediately instead of waiting out the heartbeat window.
export function releaseTab(): void {
  try {
    localStorage.removeItem(ALIVE_PREFIX + tabId());
  } catch {
    // Best effort.
  }
}

/**
 * Puts backed-up edits for `userId` back into this tab's sessionStorage.
 * Call it after sign-in and BEFORE the pages mount - they read their drafts
 * once, when they mount. Returns how many sheets (a sheet = one page's
 * date/shift) were restored, for the "recovered" notice.
 */
export function restoreDraftBackup(userId: number): number {
  let restoredSheets = 0;
  try {
    const me = tabId();
    const now = Date.now();
    for (const k of backupKeys()) {
      const b = readBackup(localStorage.getItem(k));
      if (!b || now - b.at > MAX_AGE_MS) {
        localStorage.removeItem(k);
        continue;
      }
      if (b.uid !== userId) continue;
      if (b.tab !== me && isTabAlive(b.tab, now)) continue;

      const original = k.slice(BACKUP_PREFIX.length);
      if (sessionStorage.getItem(original) !== null) continue; // newer work already here

      sessionStorage.setItem(original, b.value);
      localStorage.setItem(k, JSON.stringify({ ...b, tab: me }));
      if (
        original.startsWith(ENTRY_PREFIX) ||
        original.startsWith(MANUAL_COUNT_PREFIX)
      )
        restoredSheets++;
    }
  } catch {
    // Best effort.
  }
  return restoredSheets;
}

/**
 * Log out while keeping the edits for the same person's next sign-in: takes
 * a final backup, hands it to the "parked" owner so no sync can sweep it,
 * then clears the staged edits from this tab (so nobody else signing in on
 * it sees them).
 */
export function parkDraftsForLogout(userId: number): void {
  try {
    syncDraftBackup(userId);
    const me = tabId();
    for (const k of backupKeys()) {
      const b = readBackup(localStorage.getItem(k));
      if (b && b.tab === me && b.uid === userId)
        localStorage.setItem(k, JSON.stringify({ ...b, tab: PARKED }));
    }
    for (const k of sessionKeys()) sessionStorage.removeItem(k);
  } catch {
    // Best effort.
  }
}

/// Drops every backup. For deliberate discards: a confirmed log out and Data
/// Reset (where restoring would write edits against data that no longer
/// exists).
export function clearDraftBackups(): void {
  try {
    for (const k of backupKeys()) localStorage.removeItem(k);
  } catch {
    // Best effort.
  }
}
