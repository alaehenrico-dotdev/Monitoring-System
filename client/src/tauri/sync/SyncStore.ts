// Tiny shared store so the header's Sync button can show/trigger the sync
// engine that useSyncEngine() runs (it's mounted once, in OfflineSyncBadge) -
// without a second copy of the engine's timers living in the header.
import { useSyncExternalStore } from "react";

export interface SyncUiState {
  syncing: boolean;
  failed: boolean;
  lastSyncedAt: number | null;
}

let state: SyncUiState = { syncing: false, failed: false, lastSyncedAt: null };
let runner: (() => Promise<void>) | null = null;
const listeners = new Set<() => void>();

export function setSyncUiState(patch: Partial<SyncUiState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function hydrateLastSyncedAt(lastSyncedAt: number | null) {
  // A fresh sync can finish while SQLite is being read on launch. Hydration
  // should only fill the empty initial value, never replace that fresh result.
  if (state.lastSyncedAt === null && lastSyncedAt !== null) {
    setSyncUiState({ lastSyncedAt });
  }
}

export function registerSyncRunner(fn: () => Promise<void>): () => void {
  runner = fn;
  return () => {
    if (runner === fn) runner = null;
  };
}

/// Runs a full push+pull now (no-op while one is already running).
export async function requestSync(): Promise<void> {
  await runner?.();
}

export function useSyncUiState(): SyncUiState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
