// Generic offline support for the Tauri desktop build only (see src/tauri/ -
// never imported by the plain web build). Two jobs, for endpoints that don't
// have their own structured sync (see sync/ for the ones that do - Product,
// DailyOnlineStock, DailyOfflineStock, ManualCount):
//
// 1. Read cache - the last successful response for a GET path, so a grid or
//    report that's already been opened stays viewable if the server becomes
//    unreachable, instead of going blank.
// 2. Write outbox - a Save that fails because the server is unreachable gets
//    queued here (in order) instead of just failing, and is replayed once
//    the app detects the server is reachable again.
//
// Both tables live in the shared local SQLite database (db.ts), with every
// payload encrypted at rest via Windows DPAPI (src-tauri/src/dpapi.rs,
// Scope::User) before it touches disk - this is what "encrypted local
// database" means here: protects the file's contents if it's copied off
// this machine or read by a different Windows account, not against someone
// already logged into this same Windows account.
import { invoke } from "@tauri-apps/api/core";
import { getDb } from "./db";

async function encrypt(plaintext: string): Promise<string> {
  return invoke<string>("encrypt_dpapi", { plaintext });
}

async function decrypt(ciphertext: string): Promise<string> {
  return invoke<string>("decrypt_dpapi", { ciphertext });
}

/// Best-effort - a caching failure should never break the actual request it
/// piggybacks on, so every call site fires this without awaiting/catching.
export async function cacheResponse(path: string, data: unknown): Promise<void> {
  try {
    const db = await getDb();
    const encrypted = await encrypt(JSON.stringify(data));
    await db.execute(
      `INSERT INTO cached_responses (path, data, cached_at) VALUES ($1, $2, $3)
       ON CONFLICT(path) DO UPDATE SET data = $2, cached_at = $3`,
      [path, encrypted, new Date().toISOString()],
    );
  } catch (err) {
    console.error("Failed to cache response", err);
  }
}

export async function getCachedResponse<T>(path: string): Promise<T | null> {
  try {
    const db = await getDb();
    const rows = await db.select<{ data: string }[]>("SELECT data FROM cached_responses WHERE path = $1", [path]);
    if (rows.length === 0) return null;
    const decrypted = await decrypt(rows[0].data);
    return JSON.parse(decrypted) as T;
  } catch (err) {
    console.error("Failed to read cached response", err);
    return null;
  }
}

export interface PendingWrite {
  id: number;
  method: string;
  path: string;
  /// Already JSON.stringify'd (this is exactly what http.ts's request()
  /// received as RequestInit.body) - stored as the raw string rather than
  /// re-parsed/re-stringified, so replaying it is a direct fetch body with
  /// no risk of double-encoding.
  body: string | undefined;
}

export async function queueWrite(method: string, path: string, body: string | undefined): Promise<void> {
  const db = await getDb();
  const encrypted = body === undefined ? null : await encrypt(body);
  await db.execute("INSERT INTO pending_writes (method, path, body, created_at) VALUES ($1, $2, $3, $4)", [
    method,
    path,
    encrypted,
    new Date().toISOString(),
  ]);
}

export async function getPendingWrites(): Promise<PendingWrite[]> {
  const db = await getDb();
  const rows = await db.select<{ id: number; method: string; path: string; body: string | null }[]>(
    "SELECT id, method, path, body FROM pending_writes ORDER BY id ASC",
  );
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      method: r.method,
      path: r.path,
      body: r.body ? await decrypt(r.body) : undefined,
    })),
  );
}

export async function getPendingWriteCount(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>("SELECT COUNT(*) as count FROM pending_writes");
  return rows[0]?.count ?? 0;
}

async function removePendingWrite(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM pending_writes WHERE id = $1", [id]);
}

export interface FlushResult {
  flushed: number;
  /// Writes the server actively rejected (not a connectivity failure) - the
  /// server was reachable and said no, so retrying forever wouldn't help.
  /// Removed from the queue either way; the caller decides how to surface
  /// these (e.g. "this offline entry couldn't be saved, please redo it").
  rejected: { write: PendingWrite; error: string }[];
}

/// Replays the outbox in the order writes were queued, stopping at the first
/// connectivity failure (no point trying the rest if the server's still
/// unreachable) rather than per-write, so order is preserved for whatever
/// comes next time this runs.
export async function flushPendingWrites(
  send: (method: string, path: string, body: string | undefined) => Promise<void>,
): Promise<FlushResult> {
  const result: FlushResult = { flushed: 0, rejected: [] };
  const writes = await getPendingWrites();
  for (const write of writes) {
    try {
      await send(write.method, write.path, write.body);
      await removePendingWrite(write.id);
      result.flushed++;
    } catch (err) {
      if (isNetworkError(err)) break;
      // The server rejected this one on its own merits - won't succeed on
      // retry, so it comes out of the queue rather than blocking every
      // write queued after it.
      await removePendingWrite(write.id);
      result.rejected.push({ write, error: err instanceof Error ? err.message : "Request failed" });
    }
  }
  return result;
}

/// Shared with http.ts's own network-vs-rejection check - a plain fetch()
/// failure (DNS, connection refused, timeout) throws a TypeError with no
/// HTTP status, unlike a reachable server's 4xx/5xx (ApiError, which has
/// one). Exported so http.ts and this module agree on the same definition.
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}
