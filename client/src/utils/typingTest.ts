/// Pure helpers for the header's typing practice (components/TypingPractice.tsx).

export type TypingMode = "mix" | "words" | "sentences" | "numbers";
export const MODES: readonly { id: TypingMode; label: string }[] = [
  { id: "mix", label: "Mix" },
  { id: "words", label: "Words" },
  { id: "sentences", label: "Sentences" },
  { id: "numbers", label: "Numbers" },
];

type Rand = () => number;

const pick = <T>(list: readonly T[], rand: Rand): T =>
  list[Math.min(Math.floor(rand() * list.length), list.length - 1)];

/// n distinct items, in random order (partial Fisher-Yates).
function sample<T>(list: readonly T[], n: number, rand: Rand): T[] {
  const a = [...list];
  const out: T[] = [];
  for (let i = 0; i < Math.min(n, a.length); i++) {
    const j =
      i + Math.min(Math.floor(rand() * (a.length - i)), a.length - i - 1);
    [a[i], a[j]] = [a[j], a[i]];
    out.push(a[i]);
  }
  return out;
}

const WORDS: readonly string[] = (
  "stock count shift order batch carton pallet row column sheet entry total balance variance audit " +
  "report online offline transfer delivery pickup return damaged missing extra opening closing morning " +
  "evening night supervisor encoder product category price unit case box label scan check recount " +
  "adjust correct submit review approve save update record ledger daily weekly monthly steady quick " +
  "careful accurate clear clean ready empty full small large first second last early late again " +
  "never always before after during between under over home keys finger rhythm focus speed pace " +
  "table chair window door light water green yellow red blue north south east west bread rice sugar " +
  "salt oil milk flour coffee tea juice noodles sauce soap tissue candy snack bottle sack bag"
).split(" ");

const SUBJECTS = [
  "The night shift",
  "Every encoder",
  "The supervisor",
  "Our warehouse team",
  "The online desk",
  "A careful clerk",
  "The morning crew",
];
const VERBS = [
  "recounts",
  "checks",
  "reconciles",
  "logs",
  "reviews",
  "flags",
  "double-checks",
  "updates",
];
const OBJECTS = [
  "the opening stock",
  "every variance",
  "the daily report",
  "a damaged carton",
  "the transfer sheet",
  "each late delivery",
  "the manual count",
  "all missing units",
];
const TAILS = [
  "before the shift ends",
  "twice to be safe",
  "without skipping a row",
  "while the floor is quiet",
  "after the last pickup",
  "and never guesses a number",
  "so the totals agree",
];

function sentence(rand: Rand): string {
  return `${pick(SUBJECTS, rand)} ${pick(VERBS, rand)} ${pick(OBJECTS, rand)} ${pick(TAILS, rand)}.`;
}

function numberToken(rand: Rand): string {
  const r = rand();
  if (r < 0.2)
    return `AE-${String(Math.floor(rand() * 10000)).padStart(4, "0")}`; // SKU-style code
  const digits = 1 + Math.floor(rand() * 4);
  return String(Math.floor(rand() * 10 ** digits));
}

function generateFor(mode: Exclude<TypingMode, "mix">, rand: Rand): string {
  switch (mode) {
    case "words":
      return sample(WORDS, 14 + Math.floor(rand() * 5), rand).join(" ");
    case "sentences":
      return `${sentence(rand)} ${sentence(rand)}`;
    case "numbers":
      return Array.from({ length: 12 + Math.floor(rand() * 5) }, () =>
        numberToken(rand),
      ).join(" ");
  }
}

/// A fresh random passage for `mode` ("mix" picks a kind at random each time).
/// Never returns `previous` again.
export function generatePassage(
  mode: TypingMode = "mix",
  previous?: string,
  rand: Rand = Math.random,
): string {
  for (let attempt = 0; attempt < 5; attempt++) {
    const kind =
      mode === "mix"
        ? pick(["words", "sentences", "numbers"] as const, rand)
        : mode;
    const text = generateFor(kind, rand);
    if (text !== previous) return text;
  }
  return generateFor("words", rand) + " ";
}

export interface TypingStats {
  /** Correct characters / 5 per minute - the standard "word" is five characters. */
  wpm: number;
  /** 0-100, share of typed characters that match the passage. */
  accuracy: number;
  correct: number;
  typed: number;
}

export function computeStats(
  target: string,
  typed: string,
  elapsedMs: number,
): TypingStats {
  let correct = 0;
  for (let i = 0; i < typed.length; i++) if (typed[i] === target[i]) correct++;
  const minutes = Math.max(elapsedMs, 1) / 60_000;
  return {
    wpm: typed.length === 0 ? 0 : Math.round(correct / 5 / minutes),
    accuracy:
      typed.length === 0 ? 100 : Math.round((correct / typed.length) * 100),
    correct,
    typed: typed.length,
  };
}

/// ---- On-screen keyboard model ----

export interface KeyDef {
  /** Stable id: the unshifted character for printable keys, else a name. */
  id: string;
  /** Printed label (unshifted). */
  label: string;
  /** Shifted character, for printable keys that have one. */
  shift?: string;
  /** Width in key units. */
  w: number;
  /** Character a click types; undefined for modifier/inert keys. */
  type?: string;
}

const printable = (base: string, shift?: string): KeyDef => ({
  id: base,
  label: base,
  shift,
  w: 1,
  type: base,
});
const letters = (s: string): KeyDef[] =>
  s.split("").map((c) => printable(c, c.toUpperCase()));
const pairs = (s: string, shifted: string): KeyDef[] =>
  s.split("").map((c, i) => printable(c, shifted[i]));

export const KEY_ROWS: readonly (readonly KeyDef[])[] = [
  [
    ...pairs("`1234567890-=", "~!@#$%^&*()_+"),
    { id: "Backspace", label: "⌫", w: 2 },
  ],
  [
    { id: "Tab", label: "Tab", w: 1.5 },
    ...letters("qwertyuiop"),
    ...pairs("[]", "{}"),
    printable("\\", "|"),
  ].map((k) => (k.id === "\\" ? { ...k, w: 1.5 } : k)),
  [
    { id: "Caps", label: "Caps", w: 1.75 },
    ...letters("asdfghjkl"),
    ...pairs(";'", ':"'),
    { id: "Enter", label: "Enter", w: 2.25 },
  ],
  [
    { id: "ShiftLeft", label: "Shift", w: 2.25 },
    ...letters("zxcvbnm"),
    ...pairs(",./", "<>?"),
    { id: "ShiftRight", label: "Shift", w: 2.75 },
  ],
  [{ id: "Space", label: "", w: 6, type: " " }],
];

const CHAR_TO_KEY = new Map<string, { id: string; shift: boolean }>();
for (const row of KEY_ROWS)
  for (const k of row) {
    if (k.type === undefined) continue;
    CHAR_TO_KEY.set(k.type, { id: k.id, shift: false });
    if (k.shift) CHAR_TO_KEY.set(k.shift, { id: k.id, shift: true });
  }

/// The key (and whether Shift is needed) that types `ch`, or null if the
/// keyboard has no such key.
export function keyForChar(ch: string): { id: string; shift: boolean } | null {
  return CHAR_TO_KEY.get(ch) ?? null;
}

/// Which on-screen key a physical keystroke lights up.
export function keyIdFromEvent(e: {
  key: string;
  code: string;
}): string | null {
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") return e.code;
  if (e.key === " ") return "Space";
  if (e.key === "Backspace" || e.key === "Tab" || e.key === "Enter")
    return e.key;
  if (e.key === "CapsLock") return "Caps";
  return CHAR_TO_KEY.get(e.key)?.id ?? null;
}
