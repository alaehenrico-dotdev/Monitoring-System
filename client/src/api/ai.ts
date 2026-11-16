import { http } from "./http";
import type { Shift } from "../types";

/// A plain-language read of one count's variance, written by the server's AI helper
/// (server services/aiExplain.service.ts). Read-only and Supervisor/Admin only; the
/// API key stays on the server. Not in http.ts's IDEMPOTENT_PATH body check because it
/// sends no body - there is nothing to save, so a retry is harmless.
export interface VarianceExplanation {
  explanation: string;
  model: string;
}

export function explainVariance(
  productId: number,
  date: string,
  shift: Shift,
  location: "ONLINE" | "OFFLINE",
) {
  return http.post<VarianceExplanation>(
    `/manual-counts/explain?productId=${productId}&date=${date}&shift=${shift}&location=${location}`,
  );
}

// ---------------------------------------------------------------------------------------
// Dashboard AI (server routes /dashboard/ai/*): Supervisor/Admin only, key stays server-side.

/// Whether the AI helpers are set up; the dashboard leaves their card out when not.
export interface AiStatus {
  enabled: boolean;
  model: string | null;
  windows: number[];
}
export const getAiStatus = () => http.get<AiStatus>("/dashboard/ai/status");

export interface ChangeDelta {
  previous: number;
  current: number;
  change: number;
  /// Null when the earlier figure was 0.
  changePct: number | null;
}
export interface ChangeMover {
  sku: string | null;
  name: string;
  unit: string;
  previous: number;
  current: number;
  change: number;
}
export interface ChangeFacts {
  days: number;
  current: { from: string; to: string };
  previous: { from: string; to: string };
  currentWindowMayBePartial: boolean;
  enoughHistory: boolean;
  totals: {
    totalOut: ChangeDelta;
    onlineOut: ChangeDelta;
    offlineOut: ChangeDelta;
    backloads: ChangeDelta;
    rts: ChangeDelta;
    productionIn: ChangeDelta;
    absVariance: ChangeDelta;
    flaggedProducts: ChangeDelta;
  };
  outflowUp: ChangeMover[];
  outflowDown: ChangeMover[];
  varianceUp: ChangeMover[];
}
/// The comparison is computed by the server; `explanation` is the AI's reading of it
/// (null when there is no earlier data to compare with).
export interface WhatChanged {
  facts: ChangeFacts;
  explanation: string | null;
  /// Set (with the reason) when the AI could not write the summary but the comparison itself is fine.
  unavailable?: string | null;
  model: string;
}
export const getWhatChanged = (days: number) => http.post<WhatChanged>(`/dashboard/ai/what-changed?days=${days}`);

export interface AskSource {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}
export interface AskAnswer {
  answer: string;
  /// The tool calls (and the rows they returned) the answer was based on.
  sources: AskSource[];
  model: string;
}
export const askData = (question: string) => http.post<AskAnswer>("/dashboard/ai/ask", { question });
