import { env } from "../config/env";
import { HttpError } from "../utils/HttpError";
import { callOpenRouter, openrouterConfigured, OpenRouterError } from "./openrouter";

/// The one place the server talks to Google's Gemini API. Used by the variance explainer
/// (services/aiExplain.service.ts), the dashboard's "What changed?" and "Ask the data"
/// (services/aiWhatChanged.service.ts, services/aiAsk.service.ts).
///
/// Failure is deliberately quiet and uniform: no key -> 503 "not set up", Google down,
/// slow or refusing -> 502 with a short generic message. Response bodies are never
/// logged or returned (they can echo request content), and the key only ever travels in
/// a header, never a URL.

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
  /// Opaque fields Gemini attaches (e.g. thought signatures). Model turns are sent back
  /// exactly as received, so these must survive untouched.
  [extra: string]: unknown;
}
export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}
export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/// The keys to use, in order. (`geminiApiKey` alone is what tests and older callers set.)
const apiKeys = (): string[] => (env.geminiApiKeys?.length ? env.geminiApiKeys : env.geminiApiKey ? [env.geminiApiKey] : []);

export const geminiConfigured = () => apiKeys().length > 0;

/// Whether ANY AI provider is set up (Gemini, or the OpenRouter fallback on its own).
export const aiConfigured = () => geminiConfigured() || openrouterConfigured();

export function requireAi() {
  if (!aiConfigured()) {
    throw new HttpError(503, "AI features are not set up. Add GEMINI_API_KEY (or OPENROUTER_API_KEY and a free OPENROUTER_MODEL) to the server settings.");
  }
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/// What the person at the dashboard sees. Setup problems say so, because "could not answer" sends people
/// hunting in the wrong place; the full detail is in the server log. Google reports several different
/// problems under the same HTTP status (a rejected key is a 400, not a 401), so this reads Google's own
/// message as well as the status. Wording that tells an admin what to do ends "Ask an admin ..." - the
/// client shows those as a detail line (client/src/utils/aiFallback.ts).
function userMessageFor(status: number, googleMessage = ""): string {
  // Google's usage limits (per minute / per day, per model, per key - the free tier's are small, and a
  // question can take two or three model calls). Waiting a minute often clears a per-minute limit; a
  // daily one needs the quota raised, so say where to look.
  if (status === 429 || /quota|rate.?limit|resource.?exhausted/i.test(googleMessage)) {
    return "The AI has reached its Google usage limit for now. Try again in a minute; if it keeps happening, check the key's quota and billing in Google AI Studio.";
  }
  if (/location is not supported/i.test(googleMessage)) {
    return "Google's AI is not available from the country this server is hosted in. Ask an admin to host it elsewhere or route it through a supported region.";
  }
  if (/api key|permission.?denied|has not been used|is disabled|referer|ip address/i.test(googleMessage) || status === 401 || status === 403) {
    return "The AI service rejected the API key. Ask an admin to check GEMINI_API_KEY (and its restrictions in Google AI Studio).";
  }
  if (status === 404) return "The AI model is not available. Ask an admin to check GEMINI_MODEL.";
  return "The AI service could not answer that.";
}

/// Model calls made so far today (UTC), whatever their outcome - Google counts attempts, not successes.
/// One process, so a counter in memory is enough; a restart resets it, which only ever errs on the side of
/// allowing more, and the per-user limiter and Google's own quota still apply.
let usage = { day: "", calls: 0 };

/// Backup keys. A key that was just refused (out of quota, or rejected) is skipped for a while so every request
/// does not first spend a call on it. A per-minute limit clears in about a minute; a rejected key will not fix
/// itself, so it is left alone much longer. The primary key is always tried first once its time is up.
/// Keyed by the key's position in the list (never the key itself), so nothing secret is held here.
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const REJECTED_KEY_COOLDOWN_MS = 10 * 60_000;
let cooldowns = new Map<number, { until: number; failure: HttpError }>();
/// The same idea for the OpenRouter fallback (its free tier is small: 20 a minute, 50 a day).
let openrouterCooldown: { until: number; failure: HttpError } | null = null;

/// A failure that is about THIS key (its quota or its validity), so the next key may well work. Anything else
/// (Google down, a bad request, an unknown model) would fail the same on every key and is not retried.
class KeyFailure extends Error {
  constructor(
    readonly failure: HttpError,
    readonly cooldownMs: number,
  ) {
    super(failure.message);
  }
}

/// For tests: forget today's count and every cooldown.
export function resetAiUsage(): void {
  usage = { day: "", calls: 0 };
  cooldowns = new Map();
  openrouterCooldown = null;
}

function takeDailyAllowance(): void {
  const limit = env.aiDailyCallLimit ?? 0;
  if (limit <= 0) return;
  const today = new Date().toISOString().slice(0, 10);
  if (usage.day !== today) usage = { day: today, calls: 0 };
  if (usage.calls >= limit) {
    console.error(JSON.stringify({ level: "warn", event: "ai-daily-limit-reached", limit, day: today }));
    // 429, not 502: nothing is wrong with Google or the key. "Ask an admin" is what the client reads as a
    // setup message (no pointless Try again).
    throw new HttpError(429, "The AI has reached today's call limit for this server. Ask an admin to raise AI_DAILY_CALL_LIMIT, or try again tomorrow.");
  }
  usage.calls++;
}

export interface GenerateOptions {
  system: string;
  contents: GeminiContent[];
  /// With tools, the model may answer with functionCall parts; "NONE" forces a text answer.
  tools?: GeminiFunctionDeclaration[];
  toolMode?: "AUTO" | "NONE";
  maxOutputTokens?: number;
  timeoutMs?: number;
  /// Log label, e.g. "ai-explain".
  event: string;
}

/// One model call. Gemini first (its keys in order, see below). Only if Gemini fails for a reason that is about
/// Google - a 502: out of quota, a rejected key, unreachable, no answer - and the OpenRouter fallback is set up,
/// the same request is sent there. Our own daily cap (429) and "not set up" (503) never trigger a fallback: they
/// are decisions, not Google failing. If the fallback fails too, Gemini's reason is the one reported (the
/// fallback's goes to the log), because that is what the admin should look at first.
/// With no Gemini key at all, OpenRouter simply is the provider.
/// Returns the model's turn (its parts, untouched).
export async function generate(opts: GenerateOptions): Promise<GeminiContent> {
  requireAi();
  const keys = apiKeys();
  if (keys.length === 0) return generateWithOpenRouter(opts, false);

  try {
    return await generateWithGemini(opts, keys);
  } catch (err) {
    if (!openrouterConfigured() || !(err instanceof HttpError) || err.status !== 502) throw err;
    console.error(JSON.stringify({ level: "warn", event: "ai-provider-fallback", from: "gemini", to: "openrouter", reason: err.message.slice(0, 80) }));
    try {
      return await generateWithOpenRouter(opts, true);
    } catch (second) {
      // The daily cap is shared by both providers; if THAT is what stopped the fallback, say so.
      if (second instanceof HttpError && second.status === 429) throw second;
      throw err;
    }
  }
}

async function generateWithOpenRouter(opts: GenerateOptions, hasGemini: boolean): Promise<GeminiContent> {
  if (openrouterCooldown && openrouterCooldown.until > Date.now()) throw openrouterCooldown.failure;
  takeDailyAllowance();
  try {
    return await callOpenRouter(opts);
  } catch (err) {
    if (!(err instanceof OpenRouterError)) throw err;
    // Cool it down only when Gemini is there to carry on meanwhile; as the only provider every request must
    // still be tried, or "Try again" would fail for a minute without even asking.
    if (hasGemini) {
      const ms = err.status === 429 ? RATE_LIMIT_COOLDOWN_MS : [401, 402, 403, 404].includes(err.status) ? REJECTED_KEY_COOLDOWN_MS : 0;
      if (ms) openrouterCooldown = { until: Date.now() + ms, failure: err.failure };
    }
    throw err.failure;
  }
}

/// The Gemini keys, in order: the first that is not cooling down; on a key-specific failure (quota or a rejected
/// key) the next key is tried.
async function generateWithGemini(opts: GenerateOptions, keys: string[]): Promise<GeminiContent> {
  const now = Date.now();
  const ready = keys.map((key, index) => ({ key, index })).filter(({ index }) => (cooldowns.get(index)?.until ?? 0) <= now);
  if (ready.length === 0) {
    // Every key was refused moments ago. Say why without spending another call on one.
    console.error(JSON.stringify({ level: "warn", event: `${opts.event}-all-keys-cooling`, keys: keys.length }));
    throw cooldowns.get(0)?.failure ?? new HttpError(502, userMessageFor(429));
  }

  let last: HttpError | undefined;
  for (let n = 0; n < ready.length; n++) {
    const { key, index } = ready[n];
    takeDailyAllowance();
    try {
      return await callOnce(key, opts);
    } catch (err) {
      if (!(err instanceof KeyFailure)) throw err;
      // Cooling a key down only makes sense when there is another key to use meanwhile. With a single key
      // every request must still ask Google, or "Try again" would fail for a minute without even trying.
      if (keys.length > 1) cooldowns.set(index, { until: Date.now() + err.cooldownMs, failure: err.failure });
      last = err.failure;
      if (n + 1 < ready.length) {
        // Positions only (1 = GEMINI_API_KEY, 2 = GEMINI_API_KEY_2 ...) - never the key.
        console.error(JSON.stringify({ level: "warn", event: "ai-key-failover", from: index + 1, to: ready[n + 1].index + 1, status: err.failure.status }));
      }
    }
  }
  throw last as HttpError;
}

async function callOnce(apiKey: string, opts: GenerateOptions): Promise<GeminiContent> {
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiModel)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: opts.system }] },
          contents: opts.contents,
          ...(opts.tools?.length
            ? {
                tools: [{ functionDeclarations: opts.tools }],
                toolConfig: { functionCallingConfig: { mode: opts.toolMode ?? "AUTO" } },
              }
            : {}),
          generationConfig: { temperature: 0.2, maxOutputTokens: opts.maxOutputTokens ?? 1024 },
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      },
    );
  } catch (err) {
    // Not about the key: another key would hit the same network, so no failover.
    console.error(JSON.stringify({ level: "warn", event: `${opts.event}-unreachable`, message: messageOf(err) }));
    throw new HttpError(502, "The AI service did not respond. Try again in a moment.");
  }

  if (!response.ok) {
    // Google's own error status and message ("API key not valid", "model ... is no longer
    // available") are what an admin needs to fix this, so they go to the server log - capped,
    // and never to the browser. The request itself (the stock data) is never logged.
    const err = ((await response.json().catch(() => null)) as { error?: { status?: string; message?: string } } | null)?.error;
    console.error(
      JSON.stringify({
        level: "warn",
        event: `${opts.event}-failed`,
        status: response.status,
        googleStatus: err?.status,
        message: err?.message?.slice(0, 800),
        model: env.geminiModel,
      }),
    );
    const failure = new HttpError(502, userMessageFor(response.status, err?.message));
    const message = err?.message ?? "";
    if (response.status === 429 || /resource.?exhausted|quota/i.test(message)) throw new KeyFailure(failure, RATE_LIMIT_COOLDOWN_MS);
    if (response.status === 401 || response.status === 403 || (response.status === 400 && /api key/i.test(message))) {
      throw new KeyFailure(failure, REJECTED_KEY_COOLDOWN_MS);
    }
    throw failure;
  }

  const data = (await response.json()) as { candidates?: { content?: { parts?: GeminiPart[] } }[] };
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) throw new HttpError(502, "The AI service returned no answer. Try again.");
  return { role: "model", parts };
}

/// The text of a model turn ("" when it only contained function calls).
export const textOf = (content: GeminiContent) =>
  content.parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
