/// The saved replies of the header search's AI chat (components/QuickJump.tsx). Only finished answers
/// are kept: a question still being answered, or one that failed, is not a reply.
///
/// The answers quote the company's figures, so they are kept per signed-in user (two people sharing a
/// browser never see each other's), capped, validated on the way back in (storage is not trusted), and
/// wiped on sign-out and on a data reset or restore - see clearAllAiChats and its callers. They live
/// in this browser only; nothing here goes to the server.

export interface ChatSource {
  tool: string;
  args: Record<string, unknown>;
}

export interface ChatTurn {
  id: string;
  /// When the answer arrived (ms since the epoch).
  at: number;
  question: string;
  answer: string;
  sources: ChatSource[];
}

/// The newest turns kept; older ones drop off the top.
export const MAX_TURNS = 30;
const MAX_QUESTION = 300;
const MAX_ANSWER = 6000;
const PREFIX = "ae:ai-chat:";
const keyFor = (userKey: string) => `${PREFIX}${userKey}`;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function asTurn(v: unknown): ChatTurn | null {
  if (!isRecord(v)) return null;
  const { id, at, question, answer, sources } = v;
  if (typeof id !== "string" || id === "" || typeof at !== "number" || !Number.isFinite(at)) return null;
  if (typeof question !== "string" || typeof answer !== "string" || question === "" || answer === "") return null;
  const cleanSources: ChatSource[] = [];
  if (Array.isArray(sources)) {
    for (const s of sources) {
      if (isRecord(s) && typeof s.tool === "string" && isRecord(s.args)) cleanSources.push({ tool: s.tool, args: s.args });
    }
  }
  return { id, at, question: question.slice(0, MAX_QUESTION), answer: answer.slice(0, MAX_ANSWER), sources: cleanSources };
}

/// The saved turns for one user, oldest first; anything unreadable or malformed is dropped.
export function loadChat(userKey: string): ChatTurn[] {
  try {
    const raw = JSON.parse(localStorage.getItem(keyFor(userKey)) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map(asTurn)
      .filter((t): t is ChatTurn => t !== null)
      .slice(-MAX_TURNS);
  } catch {
    return [];
  }
}

export function saveChat(userKey: string, turns: ChatTurn[]): void {
  try {
    if (turns.length === 0) localStorage.removeItem(keyFor(userKey));
    else localStorage.setItem(keyFor(userKey), JSON.stringify(turns.slice(-MAX_TURNS)));
  } catch {
    /* not saved (private window, blocked site data, storage full) */
  }
}

/// Adds a turn at the end, dropping the oldest beyond the cap.
export const appendTurn = (turns: ChatTurn[], turn: ChatTurn): ChatTurn[] => [...turns, turn].slice(-MAX_TURNS);

/// Announced after every wipe, so a palette that is mounted (it lives in Layout) drops the copy of the
/// chat it holds in memory too, instead of writing it back on its next change.
export const AI_CHAT_CLEARED_EVENT = "ae:ai-chat-cleared";

/// Every user's saved chat in this browser. Called on sign-out and after a data reset or restore.
export function clearAllAiChats(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) stale.push(k);
    }
    stale.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable: nothing was saved */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AI_CHAT_CLEARED_EVENT));
}

let counter = 0;
export const newTurnId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;
