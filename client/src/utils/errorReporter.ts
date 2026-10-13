import { API_URL, getToken } from "../api/http";

export type ClientErrorSource = "boundary" | "window" | "promise" | "manual";

const DEDUPE_MS = 60_000;
const MAX_PER_MINUTE = 10;
const recent = new Map<string, number>();
let sentThisMinute: number[] = [];

/// The route, without its query string: enough to know which screen broke,
/// and nothing a user typed.
function currentPage(): string {
  const hash = window.location.hash.replace(/^#/, "") || window.location.pathname;
  return hash.split("?")[0].slice(0, 300) || "/";
}

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message || error.name, stack: error.stack };
  if (typeof error === "string") return { message: error };
  try {
    return { message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { message: String(error) };
  }
}

/**
 * Tells the server that something broke in this browser (page, message, app
 * version and - when signed in - who), so a problem on an encoder's PC is
 * visible without them having to call. Never throws and never blocks: it is
 * fire-and-forget, de-duplicated, and capped per minute so a render loop can't
 * flood the API.
 */
export function reportClientError(source: ClientErrorSource, error: unknown): void {
  try {
    const { message, stack } = describe(error);
    if (!message) return;
    const page = currentPage();

    const now = Date.now();
    const dedupeKey = `${page}|${message}`;
    const last = recent.get(dedupeKey);
    if (last !== undefined && now - last < DEDUPE_MS) return;
    sentThisMinute = sentThisMinute.filter((t) => now - t < 60_000);
    if (sentThisMinute.length >= MAX_PER_MINUTE) return;
    recent.set(dedupeKey, now);
    sentThisMinute.push(now);

    const token = getToken();
    void fetch(`${API_URL}/client-errors`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        page,
        message: message.slice(0, 1000),
        stack: stack?.slice(0, 8000),
        source,
        appVersion: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : undefined,
      }),
    }).catch(() => {
      /* the server may be the thing that is down */
    });
  } catch {
    /* reporting must never cause an error of its own */
  }
}

let installed = false;

/// Catches what React's boundary can't: errors thrown in event handlers and
/// timers, and promise rejections nobody handled.
export function installGlobalErrorReporting(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (e) => {
    // Resource load failures (an <img>) bubble here without an Error object.
    if (!e.error && !e.message) return;
    reportClientError("window", e.error ?? e.message);
  });
  window.addEventListener("unhandledrejection", (e) => {
    reportClientError("promise", e.reason);
  });
}
