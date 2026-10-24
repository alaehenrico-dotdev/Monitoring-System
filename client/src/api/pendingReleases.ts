import { http } from "./http";
import type { Shift } from "../types";

/// Finished goods that exist but cannot be sold yet (no label, no sticker...).
/// They are not stock until released; see server/src/services/pendingRelease.service.ts.

export type ReleaseStatus = "AWAITING" | "RELEASED" | "CANCELLED";
export type ReleaseLocation = "ONLINE" | "OFFLINE";

export interface PendingRelease {
  id: number;
  location: ReleaseLocation;
  productId: number;
  product: { id: number; name: string; sku: string | null; unit: string; category: string };
  /// Decimal columns arrive as strings.
  quantity: string;
  madeDate: string;
  madeShift: Shift;
  reason: string;
  status: ReleaseStatus;
  createdBy: { id: number; name: string } | null;
  createdAt: string;
  releasedAt: string | null;
  releasedBy: { id: number; name: string } | null;
  releasedEntryDate: string | null;
  releasedShift: Shift | null;
  resolutionNote: string | null;
  /// Days since they were made, as of today.
  ageDays: number;
}

export interface PendingReleaseFilters {
  status?: ReleaseStatus;
  location?: ReleaseLocation;
}

export function listPendingReleases(filters: PendingReleaseFilters, offset = 0, limit = 100) {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  if (filters.status) params.set("status", filters.status);
  if (filters.location) params.set("location", filters.location);
  return http.get<{ items: PendingRelease[]; total: number }>(`/pending-releases?${params}`);
}

export const createPendingRelease = (data: {
  location: ReleaseLocation;
  productId: number;
  quantity: number;
  madeDate: string;
  madeShift: Shift;
  reason: string;
}) => http.post<PendingRelease>("/pending-releases", data);

export const updatePendingRelease = (id: number, patch: { quantity?: number; reason?: string }) =>
  http.patch<PendingRelease>(`/pending-releases/${id}`, patch);

/// Adds the quantity to Production (In) of the given (current) shift and marks the
/// item released. Never back-dated: the server refuses a period more than a day
/// from today, and a finished period refuses the entry.
export const releasePendingRelease = (id: number, date: string, shift: Shift, note?: string) =>
  http.post<PendingRelease>(`/pending-releases/${id}/release`, { date, shift, ...(note ? { note } : {}) });

/// Writes an item off. Admin only; the reason is required.
export const cancelPendingRelease = (id: number, note: string) => http.post<PendingRelease>(`/pending-releases/${id}/cancel`, { note });
