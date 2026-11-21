import { http } from "./http";
import type { Shift } from "../types";

/// An auditor's blind count of one sheet, staged on the server until an admin accepts it (see the
/// server's countSubmission.service.ts). The auditor's calls only ever carry their own lines.

export type CountLocation = "ONLINE" | "OFFLINE";
export type SubmissionStatus = "DRAFT" | "SUBMITTED";

export interface SubmissionLine {
  productId: number;
  location: CountLocation;
  /// null: the line holds just a note (nothing counted).
  qty: number | null;
  note: string | null;
}

export interface MySubmission {
  status: SubmissionStatus;
  submittedAt: string | null;
  /// Set while an admin has sent a submitted count back for a recount.
  reopenedAt: string | null;
  reopenReason: string | null;
  lines: SubmissionLine[];
}

/// A line to save: qty null with an empty note takes the line back.
export interface DraftLine {
  productId: number;
  location: CountLocation;
  qty: number | null;
  note: string | null;
}

const sheet = (date: string, shift: Shift) => `date=${date}&shift=${shift}`;

export function getMySubmission(date: string, shift: Shift): Promise<MySubmission> {
  return http.get(`/count-submissions/mine?${sheet(date, shift)}`);
}

export function saveMyLines(date: string, shift: Shift, lines: DraftLine[]): Promise<{ saved: number; savedAt: string }> {
  return http.put(`/count-submissions/mine/lines?${sheet(date, shift)}`, { lines });
}

/// Sends both locations. `allowEmptyLocation` is the auditor saying that a location with nothing
/// counted is on purpose; without it the server refuses (409) when one is empty.
export function submitMySubmission(date: string, shift: Shift, allowEmptyLocation: boolean) {
  return http.post<{ status: SubmissionStatus; submittedAt: string }>(`/count-submissions/mine/submit?${sheet(date, shift)}`, { allowEmptyLocation });
}

/* ------------------------------------------------------------------ admin side */

export interface AdminSubmission {
  id: number;
  auditor: { id: number; name: string };
  status: SubmissionStatus;
  submittedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  updatedAt: string;
  counted: { ONLINE: number; OFFLINE: number };
  lines: SubmissionLine[];
}

export function listSubmissions(date: string, shift: Shift): Promise<AdminSubmission[]> {
  return http.get(`/count-submissions?${sheet(date, shift)}`);
}

/// Sends the chosen auditors' submitted counts back to them as drafts to recount.
export function reopenSubmissions(date: string, shift: Shift, auditorIds: number[], reason?: string) {
  return http.post<{ reopened: number }>(`/count-submissions/reopen?${sheet(date, shift)}`, { auditorIds, reason: reason?.trim() ? reason.trim() : null });
}

/// Takes the auditor's own submitted count back to edit it. Refused (409) once the sheet was published.
export function editMySubmission(date: string, shift: Shift) {
  return http.post<MySubmission>(`/count-submissions/mine/edit?${sheet(date, shift)}`, {});
}

export interface HistoryEntry {
  date: string;
  shift: Shift;
  status: SubmissionStatus;
  submittedAt: string | null;
  counted: { ONLINE: number; OFFLINE: number };
  /// Published since it was sent: closed for good.
  published: boolean;
}

/// The auditor's own recent counts, newest first.
export function getMyHistory(): Promise<HistoryEntry[]> {
  return http.get("/count-submissions/mine/history");
}

/// The reason the server records when the auditor takes their own count back (server: editMySubmission),
/// so the page can word its banner for it instead of blaming the admin.
export const EDITED_BY_AUDITOR = "The auditor is editing their submitted count.";
