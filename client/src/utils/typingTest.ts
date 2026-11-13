/// Pure helpers for the header's typing practice (components/TypingPractice.tsx).

export type TypingMode =
  "mix" | "words" | "sentences" | "paragraphs" | "numbers";
export const MODES: readonly { id: TypingMode; label: string }[] = [
  { id: "mix", label: "Mix" },
  { id: "words", label: "Words" },
  { id: "sentences", label: "Sentences" },
  { id: "paragraphs", label: "Paragraphs" },
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
  "Each new hire",
  "The offline counter",
  "Our delivery driver",
  "The evening team",
  "A tired encoder",
  "The store manager",
  "Someone on the floor",
  "The auditor",
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
  "verifies",
  "records",
  "compares",
  "corrects",
  "sorts",
  "approves",
  "scans",
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
  "the closing balance",
  "a torn label",
  "the online orders",
  "every pallet at the door",
  "the price list",
  "last night's returns",
  "the shelf totals",
];
const TAILS = [
  "before the shift ends",
  "twice to be safe",
  "without skipping a row",
  "while the floor is quiet",
  "after the last pickup",
  "and never guesses a number",
  "so the totals agree",
  "before anyone asks",
  "with a steady hand",
  "and writes down the reason",
  "even when the line is long",
  "until the sheet balances",
  "and tells the supervisor",
  "one row at a time",
];
const OPENERS = [
  "Today",
  "Early in the morning",
  "By noon",
  "After lunch",
  "At the end of the day",
  "When the truck arrives",
  "Before closing",
  "If the count is off",
];
const CONNECTORS = [
  "Then",
  "After that",
  "Meanwhile",
  "As a result",
  "In the end",
  "Next",
  "Even so",
];

/// A second and third sentence shape so a paragraph does not read like a template.
function sentence(rand: Rand): string {
  const shape = rand();
  const s = pick(SUBJECTS, rand);
  const v = pick(VERBS, rand);
  const o = pick(OBJECTS, rand);
  const t = pick(TAILS, rand);
  if (shape < 0.6) return `${s} ${v} ${o} ${t}.`;
  if (shape < 0.85)
    return `${pick(OPENERS, rand)}, ${s.toLowerCase()} ${v} ${o}.`;
  return `${s} ${v} ${o}, ${pick(CONNECTORS, rand).toLowerCase()} ${pick(VERBS, rand)} ${pick(OBJECTS, rand)}.`;
}

/// Hand-written passages: real prose with commas, colons, questions and parentheses,
/// using only characters the on-screen keyboard has.
const PARAGRAPHS: readonly string[] = [
  "A good count starts before the first box is opened. Clear the table, check the label, and say the number out loud. If two people get two different totals, count again together: it is faster than arguing about it later.",
  "Typing fast is mostly typing smoothly. Keep your wrists relaxed, let each finger return to the home row, and do not look down at the keys. Speed comes by itself once the mistakes stop, so slow down until the errors disappear.",
  "Why does a small variance matter? One missing unit today looks harmless, but a hundred of them across the month change the whole report. That is why every entry is checked, every correction has a reason, and every change is logged.",
  "The morning shift opens the books, the evening shift closes them, and the night shift catches whatever slipped through. Nobody works alone here: each shift leaves clear notes so the next one can start without asking questions.",
  "When a delivery arrives late, stay calm. Record what came in, note what is still missing, and tell the supervisor before the shift ends. A clear note now saves an hour of searching tomorrow (and a lot of guessing).",
  "Practice a little every day rather than a lot once a week. Five minutes of careful typing builds more skill than an hour of rushing. Watch your accuracy first, then your speed, and keep your eyes on the screen.",
  "Numbers are easy to mix up when you are tired: 1,086 and 1,068 look almost the same. Read each figure twice, type it once, and compare it to the sheet before you press save. A moment of doubt is better than a wrong entry.",
  "Good habits make a quiet shift. Label every carton, keep the aisles clear, and put returns in their own corner. When the work is tidy, the counts are simple, and the report almost writes itself.",
  "The best encoders are not the loudest or the fastest. They are the ones who notice when a number looks wrong, ask a short question, and fix it right away. That small habit protects the whole team's work.",
  "If the totals do not agree, do not panic and do not force them. Find the first row that differs, check the source, and correct only what you can prove. Write the reason in plain words so anyone can follow it later.",
  "Pick up the habit of reading a sheet from the bottom to the top once in a while. Your eyes skip over what they expect to see, and a different direction shows the typo that was hiding in plain sight.",
  "Be kind to your hands. Sit back, keep your elbows close, and take a short break every half hour. Tired fingers make more mistakes than slow ones, and a ten second stretch costs far less than a long list of corrections.",
  "Every product has a story in the numbers: what came in, what went out, and what is left. When those three figures tell the same story, the shelf is in order. When they do not, something is waiting to be found.",
  "On a busy day the line will be long and the phone will ring. Finish the row you are on, save it, and only then answer. A half finished entry is the easiest kind to forget and the hardest kind to trace.",
];

/// Hand-written paragraphs come out of a shuffled bag (each once before any repeats), so the
/// prose never shows up twice in a row, then a fresh mix is dealt.
let paragraphBag: string[] = [];
function nextProse(rand: Rand, avoid?: string): string {
  if (paragraphBag.length === 0)
    paragraphBag = sample(PARAGRAPHS, PARAGRAPHS.length, rand);
  const text = paragraphBag.shift()!;
  if (text === avoid && paragraphBag.length > 0) {
    paragraphBag.push(text);
    return paragraphBag.shift()!;
  }
  return text;
}

function paragraph(rand: Rand, avoid?: string): string {
  // Prose some of the time; otherwise a freshly assembled paragraph so it never gets stale.
  if (rand() < 0.4) return nextProse(rand, avoid);
  const count = 3 + Math.floor(rand() * 3);
  return Array.from({ length: count }, () => sentence(rand)).join(" ");
}

function numberToken(rand: Rand): string {
  const r = rand();
  if (r < 0.2)
    return `AE-${String(Math.floor(rand() * 10000)).padStart(4, "0")}`; // SKU-style code
  const digits = 1 + Math.floor(rand() * 4);
  return String(Math.floor(rand() * 10 ** digits));
}

function generateFor(
  mode: Exclude<TypingMode, "mix">,
  rand: Rand,
  avoid?: string,
): string {
  switch (mode) {
    case "words":
      return sample(WORDS, 14 + Math.floor(rand() * 5), rand).join(" ");
    case "sentences":
      return `${sentence(rand)} ${sentence(rand)}`;
    case "paragraphs": {
      // One continuous flow of text: enough to start, topped up as you type (see continueText).
      let text = paragraph(rand, avoid);
      while (text.length < 500) text += ` ${paragraph(rand)}`;
      return text;
    }
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
    const text = generateFor(kind, rand, previous);
    if (text !== previous) return text;
  }
  return generateFor("words", rand) + " ";
}

/// Paragraphs is a timed, continuous test (like Monkeytype or typing.com): the text keeps
/// flowing for TIMED_SECONDS instead of ending when a fixed passage runs out. Every other
/// mode is a short passage that ends when it is typed.
export const TIMED_SECONDS = 60; // the default
export const TIMER_OPTIONS: readonly number[] = [15, 30, 60, 120];
export const isTimed = (mode: TypingMode): boolean => mode === "paragraphs";

/// More text to append to a continuous passage, so the typist never reaches the end.
export function continueText(rand: Rand = Math.random): string {
  return paragraph(rand);
}

export interface TypingStats {
  /** Correct characters / 5 per minute - the standard "word" is five characters. */
  wpm: number;
  /** 0-100, share of typed characters that match the passage. */
  accuracy: number;
  correct: number;
  typed: number;
  /** Typed characters that did not match. */
  errors: number;
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
    errors: typed.length - correct,
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
