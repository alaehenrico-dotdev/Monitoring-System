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

/// A result for the display: thousands separators, up to 10 decimals, no trailing zeros.
export function formatResult(n: number): string {
  if (Object.is(n, -0)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: 10 });
}

/// The number as plain text to paste elsewhere or feed back into the next sum: no thousands
/// separators and never exponent form (String(1e-7) is "1e-7", which the parser cannot read).
export function plainResult(n: number): string {
  if (Object.is(n, -0)) return "0";
  return n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
}

/// The expression with the symbols a person expects: × ÷ − instead of * / -.
export function prettyExpression(src: string): string {
  return src.replace(/\*/g, "×").replace(/\//g, "÷").replace(/(?<=.)-|^-/g, "−").replace(/x/gi, "×");
}
