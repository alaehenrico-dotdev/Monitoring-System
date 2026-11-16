import { ApiError } from "../api/http";

/// What to show when an AI request fails, instead of a red error.
///
/// Almost every AI failure is temporary and not the person's doing - Google slow, busy or
/// unreachable - so they get a calm placeholder in the feature's own words and a way to try again,
/// and the rest of the page keeps working. Two kinds of failure are different:
///  - the server rejected the INPUT (a 400: too short, too long): that message is the useful one;
///  - a SETUP problem (key rejected, model gone, not configured): the server's message names the
///    setting to fix (GEMINI_API_KEY / GEMINI_MODEL), so it is kept as a small second line - these
///    screens are only ever shown to admins - and retrying is pointless.
export interface AiFallback {
  /// The placeholder sentence.
  text: string;
  /// A smaller second line, when there is something specific to say.
  detail?: string;
  /// Whether trying again could help.
  retry: boolean;
}

/// The server words an admin-fixable problem as "... check GEMINI_API_KEY" / "... Ask an admin ...".
const SETUP_PROBLEM = /GEMINI_|Ask an admin/;

export function aiFallback(err: unknown, placeholder: string): AiFallback {
  const message = err instanceof Error ? err.message : "";
  if (err instanceof ApiError && err.status === 400 && message) return { text: message, retry: false };
  if (SETUP_PROBLEM.test(message)) return { text: placeholder, detail: message, retry: false };
  return { text: placeholder, retry: true };
}

/// The placeholder wording per place, so the same failure reads the same everywhere.
export const AI_PLACEHOLDER = {
  search: "The AI isn't available right now. Pages and products still work - edit the text to search, or try again in a moment.",
  ask: "The AI isn't available right now. Try again in a moment.",
  changes: "Couldn't compare these periods right now. Try again in a moment.",
  changesSummary: "The AI summary isn't available right now - the figures here are still current.",
  explain: "An explanation isn't available right now. Try again in a moment.",
} as const;
