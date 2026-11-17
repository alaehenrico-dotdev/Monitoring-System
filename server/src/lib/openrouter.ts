import { env } from "../config/env";
import { HttpError } from "../utils/HttpError";
import type { GeminiContent, GeminiPart, GenerateOptions } from "./gemini";

/// The fallback AI provider: OpenRouter, restricted to its FREE models.
///
/// The rest of the app speaks one message format (Gemini's: contents, parts, functionCall /
/// functionResponse - see lib/gemini.ts). This file translates that to OpenRouter's OpenAI-style chat API and
/// the answer back, so Ask the data, What changed? and Explain this variance neither know nor care which
/// provider answered. lib/gemini.ts decides WHEN to use it (only after Gemini has failed for a reason that is
/// about Google: quota, a rejected key, Google unreachable).
///
/// Three rules, each enforced in code and not left to configuration:
///  - Free only. The model id must end in ":free" (config/env.ts refuses to start otherwise, and callOpenRouter
///    checks again), so a typo or a pasted paid model name can never spend money.
///  - Privacy. Every request asks OpenRouter to route only to hosts that do not train on prompts
///    (provider.data_collection = "deny") unless OPENROUTER_DATA_COLLECTION=allow. Fewer free models qualify.
///  - The key goes in a header, never a URL, and is never logged; neither are prompts or responses.

/// The models to try, in order. (`openrouterModel` alone is what tests and older callers set.)
const models = (): string[] => (env.openrouterModels?.length ? env.openrouterModels : env.openrouterModel ? [env.openrouterModel] : []);

export const openrouterConfigured = () => Boolean(env.openrouterApiKey) && models().length > 0;

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/// Wraps the user-facing failure with the HTTP status OpenRouter answered, so the caller can decide how long
/// to leave OpenRouter alone (a per-minute limit clears quickly; a rejected key does not).
export class OpenRouterError extends Error {
  constructor(
    readonly failure: HttpError,
    readonly status: number,
  ) {
    super(failure.message);
  }
}

// ---- OpenAI-style shapes (only what is used) ---------------------------------------------------------------
interface OaToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
type OaMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OaToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/// Gemini-shaped conversation -> OpenAI-style messages. A model turn that called functions becomes an assistant
/// message with tool_calls; the user turn that answers them becomes one "tool" message per answer, matched to its
/// call by id (or, when an id is missing, by function name and order).
export function toOpenAiMessages(system: string, contents: GeminiContent[]): OaMessage[] {
  const out: OaMessage[] = [{ role: "system", content: system }];
  let pending: { id: string; name: string }[] = [];
  let counter = 0;
  for (const turn of contents) {
    if (turn.role === "model") {
      const text = turn.parts.map((p) => p.text ?? "").join("").trim();
      const calls = turn.parts
        .filter((p) => p.functionCall)
        .map((p) => ({ id: p.functionCall!.id ?? `call_${++counter}`, name: p.functionCall!.name, args: p.functionCall!.args ?? {} }));
      pending = calls.map(({ id, name }) => ({ id, name }));
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
          : {}),
      });
      continue;
    }
    for (const p of turn.parts.filter((x) => x.functionResponse)) {
      const fr = p.functionResponse!;
      const at = pending.findIndex((c) => (fr.id ? c.id === fr.id : c.name === fr.name));
      const match = at >= 0 ? pending.splice(at, 1)[0] : undefined;
      out.push({ role: "tool", tool_call_id: match?.id ?? fr.id ?? `call_${++counter}`, content: JSON.stringify(fr.response?.result ?? fr.response ?? {}) });
    }
    const text = turn.parts
      .filter((p) => p.text !== undefined)
      .map((p) => p.text)
      .join("")
      .trim();
    if (text) out.push({ role: "user", content: text });
  }
  return out;
}

/// OpenAI-style answer -> Gemini-shaped model turn (text and/or function calls).
export function fromOpenAiResponse(data: unknown): GeminiContent {
  const message = (data as { choices?: { message?: { content?: unknown; tool_calls?: OaToolCall[] } }[] })?.choices?.[0]?.message;
  const parts: GeminiPart[] = [];
  if (typeof message?.content === "string" && message.content.trim()) parts.push({ text: message.content });
  for (const call of message?.tool_calls ?? []) {
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(call.function.arguments || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    } catch {
      // Malformed arguments: the lookup's own validation will report them to the model, which can retry.
    }
    parts.push({ functionCall: { name: call.function.name, args, id: call.id } });
  }
  if (parts.length === 0) throw new HttpError(502, "The AI service returned no answer. Try again.");
  return { role: "model", parts };
}

/// What the person sees when OpenRouter refuses. Setup problems end "Ask an admin ..." (the client shows those
/// as a detail line with no Try again). Only shown when Gemini is not available either; otherwise Gemini's own
/// reason is the one reported and this one is only logged.
function userMessageFor(status: number): string {
  if (status === 429) return "The AI has reached its OpenRouter usage limit for now. Try again in a minute; free models are limited per minute and per day.";
  if (status === 401 || status === 403) return "OpenRouter rejected the API key. Ask an admin to check OPENROUTER_API_KEY.";
  if (status === 402) return "OpenRouter reports no credit for this request. Ask an admin to check that OPENROUTER_MODEL ends in :free and the key's limit.";
  if (status === 404) {
    return "No OpenRouter host is available for OPENROUTER_MODEL under the current privacy setting. Ask an admin to choose another free model or review OPENROUTER_DATA_COLLECTION.";
  }
  return "The AI service could not answer that.";
}

/// One answer from the first free model that will give one. A model that is busy (its host's shared pool is
/// rate-limited), blocked by the privacy setting, or erroring is skipped for the next; a problem with the
/// ACCOUNT (key rejected, no credit) would fail the same on every model, so that stops at once.
export async function callOpenRouter(opts: GenerateOptions): Promise<GeminiContent> {
  const list = models();
  // Free only, checked on every call as well as at startup.
  if (list.some((m) => !m.endsWith(":free"))) {
    throw new HttpError(503, "OPENROUTER_MODEL must list free models only (every id ends in :free). Ask an admin to fix it.");
  }

  let last: OpenRouterError | undefined;
  for (let i = 0; i < list.length; i++) {
    try {
      return await callModel(list[i], opts);
    } catch (err) {
      if (!(err instanceof OpenRouterError)) throw err;
      last = err;
      if ([401, 402, 403].includes(err.status)) break;
      if (i + 1 < list.length) {
        console.error(JSON.stringify({ level: "warn", event: `${opts.event}-openrouter-next-model`, from: i + 1, to: i + 2, status: err.status }));
      }
    }
  }
  throw last as OpenRouterError;
}

async function callModel(model: string, opts: GenerateOptions): Promise<GeminiContent> {
  const tools = (opts.tools ?? []).map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.openrouterApiKey}` },
      body: JSON.stringify({
        model,
        messages: toOpenAiMessages(opts.system, opts.contents),
        temperature: 0.2,
        max_tokens: opts.maxOutputTokens ?? 1024,
        ...(tools.length ? { tools, tool_choice: opts.toolMode === "NONE" ? "none" : "auto" } : {}),
        provider: { data_collection: env.openrouterDataCollection === "allow" ? "allow" : "deny" },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", event: `${opts.event}-openrouter-unreachable`, message: err instanceof Error ? err.message : String(err) }));
    throw new HttpError(502, "The AI service did not respond. Try again in a moment.");
  }

  if (!response.ok) {
    const error = ((await response.json().catch(() => null)) as { error?: { message?: string; metadata?: { raw?: unknown } } } | null)?.error;
    // The host's own reason ("temporarily rate-limited upstream ...") is in metadata.raw and is what explains a
    // 429; it is the host's text, not our request, so it is safe to log (capped). Never the key or the prompt.
    const raw = typeof error?.metadata?.raw === "string" ? error.metadata.raw.slice(0, 200) : undefined;
    console.error(JSON.stringify({ level: "warn", event: `${opts.event}-openrouter-failed`, status: response.status, message: error?.message?.slice(0, 200), host: raw, model }));
    throw new OpenRouterError(new HttpError(502, userMessageFor(response.status)), response.status);
  }
  return fromOpenAiResponse(await response.json());
}
