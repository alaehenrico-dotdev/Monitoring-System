import type { CountLocation, DraftLine, SubmissionLine } from "../api/countSubmissions";
import type { Shift } from "../types";

/// The auditor's working copy of a count: what is typed on the phone, kept in the browser as a
/// backup (a warehouse loses signal) and sent to the server a moment after each change. Pure
/// helpers here; hooks/useAuditorDraft.ts does the timing.

/// One product's count as typed. `qty` stays text so "" (not counted yet) is different from "0"
/// (counted, nothing there) - the distinction the whole sheet is built on.
export interface Line {
  qty: string;
  note: string;
}
/// Keyed "ONLINE:12" - location and product id.
export type Draft = Record<string, Line>;

export const EMPTY_LINE: Line = { qty: "", note: "" };

/// Quantities are stored with two decimals: up to 9 whole digits, an optional ".dd".
export const QTY_PATTERN = /^\d{0,9}(\.\d{0,2})?$/;

export const lineKey = (location: CountLocation, productId: number) => `${location}:${productId}`;

/// "" -> not counted, a number -> counted, anything else (a lone ".") -> not a usable count yet.
export function parseQty(qty: string): number | null {
  if (qty === "") return null;
  const n = Number(qty);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/// A line with neither a count nor a note is just absent.
export const isEmptyLine = (l: Line) => l.qty === "" && l.note === "";

export const sameLine = (a: Line | undefined, b: Line | undefined) => (a ?? EMPTY_LINE).qty === (b ?? EMPTY_LINE).qty && (a ?? EMPTY_LINE).note === (b ?? EMPTY_LINE).note;

/// The line as the server stores it: a lone "." is not a count, so it is sent as none.
export function toDraftLine(key: string, line: Line | undefined): DraftLine {
  const [location, id] = key.split(":");
  const l = line ?? EMPTY_LINE;
  return { productId: Number(id), location: location as CountLocation, qty: parseQty(l.qty), note: l.note.trim() === "" ? null : l.note };
}

export function draftFromServer(lines: SubmissionLine[]): Draft {
  const out: Draft = {};
  for (const l of lines) {
    const line: Line = { qty: l.qty === null ? "" : String(l.qty), note: l.note ?? "" };
    if (!isEmptyLine(line)) out[lineKey(l.location, l.productId)] = line;
  }
  return out;
}

/// What the screen shows after reading the server's copy: the server's lines, except for the ones
/// typed here that have not reached the server yet - those are newer and win (including a line
/// cleared here and not yet sent).
export function mergeServerWithLocal(server: Draft, local: Draft, unsynced: ReadonlySet<string>): Draft {
  const out: Draft = { ...server };
  for (const key of unsynced) {
    const line = local[key];
    if (line && !isEmptyLine(line)) out[key] = line;
    else delete out[key];
  }
  return out;
}

export interface Stored {
  draft: Draft;
  /// Keys changed here and not yet confirmed saved by the server.
  unsynced: string[];
}

export const storageKeyFor = (userId: number, date: string, shift: Shift) => `ae:audit-count-draft:${userId}:${date}:${shift}`;

/// Reads the browser backup. Tolerates the first layout (a bare draft), whose lines are all treated
/// as not yet sent.
export function loadStored(key: string): Stored {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== "object") return { draft: {}, unsynced: [] };
    const asStored = parsed as Partial<Stored>;
    if (asStored.draft && typeof asStored.draft === "object") {
      return { draft: asStored.draft, unsynced: Array.isArray(asStored.unsynced) ? asStored.unsynced.filter((k) => typeof k === "string") : [] };
    }
    const bare = parsed as Draft;
    return { draft: bare, unsynced: Object.keys(bare) };
  } catch {
    return { draft: {}, unsynced: [] };
  }
}

export function saveStored(key: string, stored: Stored) {
  try {
    if (Object.keys(stored.draft).length === 0 && stored.unsynced.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(stored));
  } catch {
    /* private mode / full storage: the counts stay on screen, they just won't survive a reload */
  }
}

export function clearStored(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}

/// How many products are counted at a location.
export function countedAt(draft: Draft, location: CountLocation): number {
  let n = 0;
  const prefix = `${location}:`;
  for (const [key, line] of Object.entries(draft)) if (key.startsWith(prefix) && parseQty(line.qty) !== null) n++;
  return n;
}
