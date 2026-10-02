// Single shared SQLite connection + migration list for every local table the
// Tauri build uses - the generic read-cache/write-outbox (offlineStore.ts)
// and the structured per-table sync mirror (sync/*.ts) both live in the same
// file (sqlite:offline.db) rather than two separate database connections.
import Database from "@tauri-apps/plugin-sql";

const MIGRATIONS = [
  // --- generic cache/outbox (offlineStore.ts) - unmirrored endpoints only
  // (dashboard, reports, products list, change log, etc.) now that the
  // tables below have their own structured sync for the ones that need
  // real offline read+write. ---
  `CREATE TABLE IF NOT EXISTS cached_responses (
     path TEXT PRIMARY KEY,
     data TEXT NOT NULL,
     cached_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS pending_writes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     method TEXT NOT NULL,
     path TEXT NOT NULL,
     body TEXT,
     created_at TEXT NOT NULL
   )`,

  // --- structured sync (sync/*.ts) ---

  // One row, holds this install's stable identity and sync cursor.
  `CREATE TABLE IF NOT EXISTS sync_meta (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     client_id TEXT NOT NULL,
     last_synced_at TEXT
   )`,

  // Read-only mirror - never locally created/edited, only ever overwritten
  // wholesale by a pull. Server's own integer id is the key; nothing about
  // Product is ever created offline (see TAURI_SETUP.md's offline-sync
  // section for why).
  `CREATE TABLE IF NOT EXISTS products_cache (
     id INTEGER PRIMARY KEY,
     sku TEXT,
     name TEXT NOT NULL,
     category TEXT NOT NULL,
     unit TEXT NOT NULL,
     is_active INTEGER NOT NULL,
     sort_order INTEGER NOT NULL,
     low_stock_threshold REAL,
     updated_at TEXT NOT NULL
   )`,

  // daily_online_stock: cache holds the last-known server row (our merge
  // baseline); pending holds this client's own desired DELTA for each
  // additive field, recomputed (not accumulated) on every local edit - see
  // sync/localDb.ts's stageOnlineEdit. local_id is a client-generated UUID,
  // stable from the moment a row is first touched offline or pulled from
  // the server, so a brand-new offline entry has a real identity before it
  // has ever been pushed. Transfer fields (stock_in_off_to_ol/
  // stock_out_ol_to_off) are mirrored for display only - never offline-
  // editable, never part of pending (disabled in the UI while offline).
  `CREATE TABLE IF NOT EXISTS daily_online_stock_cache (
     local_id TEXT PRIMARY KEY,
     server_id INTEGER,
     product_id INTEGER NOT NULL,
     entry_date TEXT NOT NULL,
     shift TEXT NOT NULL,
     opening_stock REAL NOT NULL,
     stock_in_off_to_ol REAL NOT NULL,
     stock_out_ol_to_off REAL NOT NULL,
     online_stock REAL NOT NULL,
     production_in REAL NOT NULL,
     fulfillment_out REAL NOT NULL,
     rts REAL NOT NULL,
     remaining_stock REAL NOT NULL,
     encoded_by_id INTEGER,
     updated_at TEXT NOT NULL,
     UNIQUE (product_id, entry_date, shift)
   )`,
  `CREATE TABLE IF NOT EXISTS daily_online_stock_pending (
     local_id TEXT PRIMARY KEY,
     production_in REAL NOT NULL DEFAULT 0,
     fulfillment_out REAL NOT NULL DEFAULT 0,
     rts REAL NOT NULL DEFAULT 0,
     baseline_updated_at TEXT,
     staged_at TEXT NOT NULL
   )`,

  // daily_offline_stock - same shape as online, plus the five delivery
  // slots (deliveryOut itself is never stored/staged - always the sum of
  // the slots, recomputed server-side same as it is today).
  `CREATE TABLE IF NOT EXISTS daily_offline_stock_cache (
     local_id TEXT PRIMARY KEY,
     server_id INTEGER,
     product_id INTEGER NOT NULL,
     entry_date TEXT NOT NULL,
     shift TEXT NOT NULL,
     opening_stock REAL NOT NULL,
     stock_in_ol_to_off REAL NOT NULL,
     stock_out_off_to_ol REAL NOT NULL,
     offline_stock REAL NOT NULL,
     production_in REAL NOT NULL,
     delivery_out REAL NOT NULL,
     delivery1 REAL NOT NULL,
     delivery2 REAL NOT NULL,
     delivery3 REAL NOT NULL,
     delivery4 REAL NOT NULL,
     delivery5 REAL NOT NULL,
     backloads REAL NOT NULL,
     upsell_out REAL NOT NULL,
     remaining_stock REAL NOT NULL,
     encoded_by_id INTEGER,
     updated_at TEXT NOT NULL,
     UNIQUE (product_id, entry_date, shift)
   )`,
  `CREATE TABLE IF NOT EXISTS daily_offline_stock_pending (
     local_id TEXT PRIMARY KEY,
     production_in REAL NOT NULL DEFAULT 0,
     delivery1 REAL NOT NULL DEFAULT 0,
     delivery2 REAL NOT NULL DEFAULT 0,
     delivery3 REAL NOT NULL DEFAULT 0,
     delivery4 REAL NOT NULL DEFAULT 0,
     delivery5 REAL NOT NULL DEFAULT 0,
     backloads REAL NOT NULL DEFAULT 0,
     upsell_out REAL NOT NULL DEFAULT 0,
     baseline_updated_at TEXT,
     staged_at TEXT NOT NULL
   )`,

  // manual_counts - manualCount is NON-additive (a physical count, not an
  // event), so pending stores the desired absolute value directly, not a
  // delta - see sync/localDb.ts's stageManualCount.
  `CREATE TABLE IF NOT EXISTS manual_counts_cache (
     local_id TEXT PRIMARY KEY,
     server_id INTEGER,
     product_id INTEGER NOT NULL,
     entry_date TEXT NOT NULL,
     shift TEXT NOT NULL,
     location TEXT NOT NULL,
     system_remaining_stock REAL NOT NULL,
     manual_count REAL NOT NULL,
     variance REAL NOT NULL,
     counted_by_id INTEGER,
     updated_at TEXT NOT NULL,
     UNIQUE (product_id, entry_date, shift, location)
   )`,
  `CREATE TABLE IF NOT EXISTS manual_counts_pending (
     local_id TEXT PRIMARY KEY,
     manual_count REAL NOT NULL,
     baseline_updated_at TEXT,
     staged_at TEXT NOT NULL
   )`,

  // One row per field-level conflict the server couldn't auto-merge,
  // surfaced in the conflicts review screen until a human resolves it.
  `CREATE TABLE IF NOT EXISTS sync_conflicts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     table_name TEXT NOT NULL,
     product_id INTEGER NOT NULL,
     entry_date TEXT NOT NULL,
     shift TEXT NOT NULL,
     location TEXT,
     reason TEXT NOT NULL,
     mine_value TEXT NOT NULL,
     server_value TEXT NOT NULL,
     detected_at TEXT NOT NULL,
     resolved INTEGER NOT NULL DEFAULT 0
   )`,
];

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:offline.db").then(async (db) => {
      for (const sql of MIGRATIONS) await db.execute(sql);
      return db;
    });
  }
  return dbPromise;
}
