/// Pure helpers for the header calculator (components/Calculator.tsx). The expression is parsed by
/// hand (a small recursive-descent parser) - never eval - so only numbers, + - × ÷, brackets and %
/// can ever run.

export type CalcResult = { ok: true; value: number } | { ok: false; error: string };

type Tok = { t: "num"; v: number } | { t: "op"; v: "+" | "-" | "*" | "/" } | { t: "(" } | { t: ")" } | { t: "%" };

/// Typed characters as the person sees them (× ÷ −) or as a keyboard sends them (* / -).
function tokenize(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === " ") {
      i++;
    } else if ((c >= "0" && c <= "9") || c === ".") {
      let j = i;
      let dots = 0;
      // A comma between digits is a thousands separator inside the number ("1,000"), not a break.
      const isDigit = (ch: string | undefined) => ch !== undefined && ch >= "0" && ch <= "9";
      while (j < src.length && (isDigit(src[j]) || src[j] === "." || (src[j] === "," && isDigit(src[j - 1]) && isDigit(src[j + 1])))) {
        if (src[j] === ".") dots++;
        j++;
      }
      const text = src.slice(i, j).replace(/,/g, "");
      if (dots > 1 || text === ".") return null;
      toks.push({ t: "num", v: Number(text) });
      i = j;
    } else if (c === "+") {
      toks.push({ t: "op", v: "+" });
      i++;
    } else if (c === "-" || c === "−" || c === "–") {
      toks.push({ t: "op", v: "-" });
      i++;
    } else if (c === "*" || c === "×" || c === "x" || c === "X") {
      toks.push({ t: "op", v: "*" });
      i++;
    } else if (c === "/" || c === "÷") {
      toks.push({ t: "op", v: "/" });
      i++;
    } else if (c === "(") {
      toks.push({ t: "(" });
      i++;
    } else if (c === ")") {
      toks.push({ t: ")" });
      i++;
    } else if (c === "%") {
      toks.push({ t: "%" });
      i++;
    } else {
      return null;
    }
  }
  return toks;
}

class CalcError extends Error {}

/// Grammar:  expr := term (('+'|'-') term)*   term := unary (('*'|'/') unary)*
///           unary := ('+'|'-') unary | primary   primary := (number | '(' expr ')') '%'*
/// A percentage on the right of + or - is a share of the left side, as on a handheld calculator:
/// 200 + 10% is 220, not 200.1. Anywhere else it just means "divided by 100": 50% is 0.5.
function parse(toks: Tok[]): number {
  let pos = 0;
  const peek = () => toks[pos];

  type Val = { v: number; pct: boolean };

  function primary(): Val {
    const tok = toks[pos++];
    let val: Val;
    if (!tok) throw new CalcError("Incomplete expression");
    if (tok.t === "num") {
      val = { v: tok.v, pct: false };
    } else if (tok.t === "(") {
      const inner = expr();
      if (toks[pos]?.t !== ")") throw new CalcError("Missing closing bracket");
      pos++;
      val = { v: inner, pct: false };
    } else {
      throw new CalcError("Check the expression");
    }
    while (peek()?.t === "%") {
      pos++;
      val = { v: val.v / 100, pct: true };
    }
    return val;
  }

  function unary(): Val {
    const tok = peek();
    if (tok?.t === "op" && (tok.v === "+" || tok.v === "-")) {
      pos++;
      const inner = unary();
      return { v: tok.v === "-" ? -inner.v : inner.v, pct: inner.pct };
    }
    return primary();
  }

  function term(): Val {
    let left = unary();
    for (;;) {
      const tok = peek();
      if (tok?.t === "op" && (tok.v === "*" || tok.v === "/")) {
        pos++;
        const right = unary();
        if (tok.v === "/" && right.v === 0) throw new CalcError("Cannot divide by zero");
        left = { v: tok.v === "*" ? left.v * right.v : left.v / right.v, pct: false };
      } else {
        return left;
      }
    }
  }

  function expr(): number {
    let left = term().v;
    for (;;) {
      const tok = peek();
      if (tok?.t === "op" && (tok.v === "+" || tok.v === "-")) {
        pos++;
        const right = term();
        const amount = right.pct ? left * right.v : right.v;
        left = tok.v === "+" ? left + amount : left - amount;
      } else {
        return left;
      }
    }
  }

  const value = expr();
  if (pos < toks.length) throw new CalcError(toks[pos].t === ")" ? "Extra closing bracket" : "Check the expression");
  return value;
}

/// Drops binary floating-point noise (0.1 + 0.2 is 0.3, not 0.30000000000000004).
const tidy = (n: number) => Number(n.toPrecision(12));

export function evaluate(src: string): CalcResult {
  if (src.trim() === "") return { ok: false, error: "Empty" };
  const toks = tokenize(src);
  if (!toks) return { ok: false, error: "Check the expression" };
  try {
    const value = tidy(parse(toks));
    if (!Number.isFinite(value)) return { ok: false, error: "Too large" };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof CalcError ? e.message : "Check the expression" };
  }
}

/// Number formatters, built once per setting and reused: `toLocaleString` makes a new formatter on
/// every call, which is about 40 times slower, and a tape of a few hundred lines formats every line on
/// every key pressed.
const formatters = new Map<string, Intl.NumberFormat>();
function formatter(grouping: boolean, min: number, max: number): Intl.NumberFormat {
  const key = `${grouping ? 1 : 0}:${min}:${max}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { useGrouping: grouping, minimumFractionDigits: min, maximumFractionDigits: max });
    formatters.set(key, f);
  }
  return f;
}

/// A result for the display: thousands separators, up to 10 decimals, no trailing zeros.
export function formatResult(n: number): string {
  if (Object.is(n, -0)) return "0";
  return formatter(true, 0, 10).format(n);
}

/// The number as plain text to paste elsewhere or feed back into the next sum: no thousands
/// separators and never exponent form (String(1e-7) is "1e-7", which the parser cannot read).
export function plainResult(n: number): string {
  if (Object.is(n, -0)) return "0";
  return formatter(false, 0, 20).format(n);
}

/// The expression with the symbols a person expects: × ÷ − instead of * / -.
export function prettyExpression(src: string): string {
  return src.replace(/\*/g, "×").replace(/\//g, "÷").replace(/(?<=.)-|^-/g, "−").replace(/x/gi, "×");
}

/// How answers are shown: a fixed number of decimals (null = as many as there are, up to 10) and
/// whether thousands get separators. Only the display and the copied text follow it; the sum itself
/// always carries full precision.
export interface FormatOptions {
  decimals?: number | null;
  grouping?: boolean;
}

export function formatWith(n: number, o: FormatOptions = {}): string {
  if (Object.is(n, -0)) return "0";
  const { decimals = null, grouping = true } = o;
  return decimals === null ? formatter(grouping, 0, 10).format(n) : formatter(grouping, decimals, decimals).format(n);
}

/// The number as plain text to copy, rounded to the chosen decimals (all of them when null).
export function copyText(n: number, decimals: number | null = null): string {
  return plainResult(decimals === null ? n : Number(n.toFixed(decimals)));
}

/// A sum of tape lines, without floating-point noise.
export function sumLines(lines: number[]): number {
  return tidy(lines.reduce((a, b) => a + b, 0));
}

export const TAPE_MAX = 500;

/// The numbers in pasted text (a column from a spreadsheet, a list from a chat): one per line,
/// tab, semicolon or space-separated token. "1,250" is one number (a thousands comma), "1,2,3" is
/// three; anything that is not a number (labels, currency signs) is ignored.
export function parseNumberList(text: string): number[] {
  const found = text.replace(/[−–]/g, "-").match(/-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|-?\.\d+/g) ?? [];
  return found
    .map((t) => Number(t.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n))
    .slice(0, TAPE_MAX);
}

/// A count of pieces as whole packs and what is left over (7 packs + 4 pcs), or null when it does not
/// divide into whole numbers (a decimal count, a negative one, a pack of 0).
export function packSplit(pieces: number, pack: number): { packs: number; rest: number } | null {
  if (!Number.isInteger(pieces) || !Number.isInteger(pack) || pieces < 0 || pack <= 0) return null;
  return { packs: Math.floor(pieces / pack), rest: pieces % pack };
}
