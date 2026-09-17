import { ApiError, http } from "./http";

export interface ResetSummary {
  onlineStock: number;
  offlineStock: number;
  manualCounts: number;
  receipts: number;
  changeLog: number;
}

/**
 * Data Reset - passcode gate. A correct passcode earns a short-lived
 * resetToken from the server; resetAllData() has to be given that same
 * token, so the passcode is enforced server-side rather than being a UI
 * screen a request straight to the reset endpoint could skip past. A wrong
 * passcode and an expired/revoked session are both a normal "not unlocked"
 * outcome here (returns null) rather than throwing - only a genuine
 * network/server failure throws.
 */
export async function verifyResetPasscode(passcode: string): Promise<string | null> {
  try {
    const res = await http.post<{ valid: boolean; resetToken?: string }>("/data-reset/verify-passcode", { passcode });
    return res.valid && res.resetToken ? res.resetToken : null;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
}

/**
 * Wipes all transactional data (entries, counts, receipts, change log) so
 * the system can be handed to a new period/site with a clean slate. Backed
 * by POST /data-reset/reset on the server, which independently requires
 * `resetToken` (from verifyResetPasscode) and re-checks SUPERVISOR_ADMIN -
 * the client-side gates (ProtectedRoute, the passcode screen) are only a UI
 * convenience on top of that.
 */
export function resetAllData(resetToken: string) {
  return http.post<{ success: boolean; deleted: ResetSummary }>("/data-reset/reset", { resetToken });
}
