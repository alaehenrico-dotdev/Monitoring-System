import { env } from "../config/env";
import { HttpError } from "../utils/HttpError";

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

export const geminiConfigured = () => env.geminiApiKey !== "";

export function requireGemini() {
  if (!geminiConfigured()) {
    throw new HttpError(503, "AI features are not set up. Add GEMINI_API_KEY to the server settings.");
  }
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/// What the person at the dashboard sees. Setup problems (key rejected, model gone) say so,
/// because "could not answer" sends people hunting in the wrong place; the detail is in the log.
function userMessageFor(status: number): string {
  if (status === 429) return "The AI service is busy. Try again in a minute.";
  if (status === 401 || status === 403) return "The AI service rejected the API key. Ask an admin to check GEMINI_API_KEY.";
  if (status === 404) return "The AI model is not available. Ask an admin to check GEMINI_MODEL.";
  return "The AI service could not answer that.";
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

/// One model call. Returns the model's turn (its parts, untouched).
export async function generate(opts: GenerateOptions): Promise<GeminiContent> {
  requireGemini();
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiModel)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiApiKey },
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
        message: err?.message?.slice(0, 300),
        model: env.geminiModel,
      }),
    );
    throw new HttpError(502, userMessageFor(response.status));
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
