import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CalculatorIcon } from "./icons";
import { showToast } from "./Toast";
import { evaluate, formatResult, plainResult, prettyExpression } from "../utils/calculator";

/// A small calculator in the header, next to the typing practice: an icon that opens a panel under
/// it. For the sums that come up while entering stock (cases to pieces, a total of three counts, a
/// percentage) without leaving the page or reaching for a phone. It never touches the sheet.
///
/// Works with the mouse (the keypad) or the keyboard alone: digits and . + - * / x ( ) % type,
/// Enter or = calculates, Backspace deletes, C or Delete clears, Esc closes. Shows the answer as you
/// type, keeps the last few calculations (click one to reuse its result), and copies the answer.
/// The arithmetic is utils/calculator.ts: a hand-written parser, never eval.

const HISTORY_KEY = "ae:calc-history";
const HISTORY_MAX = 8;

interface Entry {
  e: string;
  r: number;
}

function readHistory(): Entry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((x): x is Entry => !!x && typeof x.e === "string" && typeof x.r === "number" && Number.isFinite(x.r))
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function writeHistory(list: Entry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    /* not remembered (private window, blocked site data) */
  }
}

/// The sum in progress and whether the panel is open, kept for this browser tab so that going to
/// another page (each page draws its own header, which resets this component) doesn't lose it.
/// sessionStorage, not localStorage: a new tab or a new visit starts clean.
const STATE_KEY = "ae:calc-state";

interface Saved {
  open: boolean;
  expr: string;
  fresh: boolean;
}

function readSaved(): Saved {
  try {
    const raw = JSON.parse(sessionStorage.getItem(STATE_KEY) ?? "null") as Partial<Saved> | null;
    // Only what the keypad can produce: a stored value is never trusted as anything else.
    if (raw && typeof raw.expr === "string" && raw.expr.length <= 200 && /^[0-9.+\-*/()%]*$/.test(raw.expr)) {
      return { open: raw.open === true, expr: raw.expr, fresh: raw.fresh === true && raw.expr !== "" };
    }
  } catch {
    /* unreadable or blocked: start clean */
  }
  return { open: false, expr: "", fresh: false };
}

function writeSaved(s: Saved): void {
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* not remembered (private window, blocked site data) */
  }
}

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isOp = (c: string | undefined) => c === "+" || c === "-" || c === "*" || c === "/";

/// The text after the last operator or bracket: the number being typed.
const lastNumber = (s: string) => s.split(/[-+*/()%]/).pop() ?? "";

/// An expression still being typed, made calculable: a dangling operator or point dropped and any open
/// brackets closed, so "12*(3+" is read as 12*(3).
function completed(s: string): string {
  const trimmed = s.replace(/[-+*/.(]+$/, "");
  const open = (trimmed.match(/\(/g) ?? []).length;
  const closed = (trimmed.match(/\)/g) ?? []).length;
  return open > closed ? trimmed + ")".repeat(open - closed) : trimmed;
}

interface KeyDef {
  label: string;
  /// What it types (or the action for the non-typing keys).
  send: string;
  name: string;
  kind?: "op" | "fn";
}

const KEYS: KeyDef[] = [
  { label: "C", send: "clear", name: "Clear", kind: "fn" },
  { label: "⌫", send: "back", name: "Backspace", kind: "fn" },
  { label: "(", send: "(", name: "Open bracket", kind: "fn" },
  { label: ")", send: ")", name: "Close bracket", kind: "fn" },
  { label: "7", send: "7", name: "7" },
  { label: "8", send: "8", name: "8" },
  { label: "9", send: "9", name: "9" },
  { label: "÷", send: "/", name: "Divide", kind: "op" },
  { label: "4", send: "4", name: "4" },
  { label: "5", send: "5", name: "5" },
  { label: "6", send: "6", name: "6" },
  { label: "×", send: "*", name: "Multiply", kind: "op" },
  { label: "1", send: "1", name: "1" },
  { label: "2", send: "2", name: "2" },
  { label: "3", send: "3", name: "3" },
  { label: "−", send: "-", name: "Minus", kind: "op" },
  { label: "0", send: "0", name: "0" },
  { label: ".", send: ".", name: "Decimal point" },
  { label: "%", send: "%", name: "Percent", kind: "fn" },
  { label: "+", send: "+", name: "Plus", kind: "op" },
];

export function HeaderCalculator() {
  // Read once, on mount, so a page change brings back the sum and the open panel.
  const [saved] = useState(readSaved);
  const [open, setOpen] = useState(saved.open);
  const [expr, setExpr] = useState(saved.expr);
  /// The answer was just calculated: the next digit starts fresh, the next operator carries on from it.
  const [fresh, setFresh] = useState(saved.fresh);
  /// Focus moves into the panel only when the person opens it, not when it comes back on a new page
  /// (that would pull focus out of whatever they were typing in).
  const userOpened = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [history, setHistory] = useState<Entry[]>(readHistory);

  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const popId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) btnRef.current?.focus();
  }, []);

  // Open: focus the panel so the keyboard works at once. Click outside closes it.
  useEffect(() => {
    writeSaved({ open, expr, fresh });
  }, [open, expr, fresh]);

  useEffect(() => {
    if (!open) return;
    if (userOpened.current) panelRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // What the display shows while typing: the answer so far, ignoring a dangling operator and
  // closing any open brackets, so "12*(3+" already shows 12*3 = 36.
  const preview = useMemo(() => {
    const s = completed(expr);
    if (s === "") return null;
    const r = evaluate(s);
    return r.ok ? r.value : null;
  }, [expr]);

  const press = useCallback(
    (key: string) => {
      setError(null);
      if (key === "clear") {
        setExpr("");
        setFresh(false);
        return;
      }
      if (key === "back") {
        setExpr((e) => e.slice(0, -1));
        setFresh(false);
        return;
      }
      if (key === "=") {
        const r = evaluate(completed(expr));
        if (!r.ok) {
          if (expr !== "") {
            setError(r.error);
            setAnnounce(r.error);
          }
          return;
        }
        // A lone number has nothing to calculate: leave it be, don't log "5 = 5".
        if (!/^-?[\d.]+$/.test(expr)) {
          const entry = { e: expr, r: r.value };
          setHistory((h) => {
            const next = [entry, ...h].slice(0, HISTORY_MAX);
            writeHistory(next);
            return next;
          });
        }
        setExpr(plainResult(r.value));
        setFresh(true);
        setAnnounce(`${prettyExpression(expr)} equals ${formatResult(r.value)}`);
        return;
      }

      setExpr((cur) => {
        const startOver = fresh && (isDigit(key) || key === "." || key === "(");
        const base = startOver ? "" : cur;
        const last = base[base.length - 1];
        if (isDigit(key)) return base + key;
        if (key === ".") {
          if (lastNumber(base).includes(".")) return base;
          return base + (isDigit(last) ? "." : "0.");
        }
        if (key === "(") return base + (isDigit(last) || last === ")" || last === "%" ? "*(" : "(");
        if (key === ")") {
          const o = (base.match(/\(/g) ?? []).length;
          const c = (base.match(/\)/g) ?? []).length;
          return o > c && (isDigit(last) || last === ")" || last === "%") ? base + ")" : base;
        }
        if (key === "%") return isDigit(last) || last === ")" || last === "%" ? base + "%" : base;
        if (isOp(key)) {
          if (base === "") return key === "-" ? "-" : base;
          // A second operator replaces the first (3+ then * is 3*), but a minus after * or / is a sign.
          if (isOp(last)) {
            if (key === "-" && (last === "*" || last === "/")) return base + key;
            if (base.length === 1) return base; // a lone leading sign stays as it is
            const trimmed = /[*/]-$/.test(base) ? base.slice(0, -2) : base.slice(0, -1);
            return trimmed + key;
          }
          if (last === "(") return key === "-" ? base + key : base;
          return base + key;
        }
        return base;
      });
      setFresh(false);
    },
    [expr, fresh],
  );

  /// Every key the calculator uses is stopped here, so none of them reaches the page's own shortcuts:
  /// the entry grid clears the selected cells on Delete, copies them on Ctrl+C and deselects on Esc,
  /// from a listener on the whole document. Typing in the calculator must never do any of that.
  function onPanelKeyDown(e: React.KeyboardEvent) {
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "Escape") {
      handled();
      close(true);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      // Ctrl+C here copies the answer - unless the person has selected some text to copy instead.
      if (window.getSelection()?.toString()) return;
      handled();
      copy();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const onButton = (e.target as HTMLElement).tagName === "BUTTON";
    if (e.key === "Enter" || e.key === "=") {
      // On a focused key, Enter presses that key (its own click); anywhere else it calculates.
      if (e.key === "Enter" && onButton) return;
      handled();
      press("=");
    } else if (e.key === "Backspace") {
      handled();
      press("back");
    } else if (e.key === "Delete" || e.key === "c" || e.key === "C") {
      handled();
      press("clear");
    } else if (/^[0-9.+\-*/()%]$/.test(e.key)) {
      handled();
      press(e.key);
    } else if (e.key === "x" || e.key === "X") {
      handled();
      press("*");
    }
  }

  /// Reuses an earlier answer: it replaces a finished answer or an empty display, and follows an
  /// operator or an open bracket mid-sum. After a digit it does nothing (two numbers can't touch).
  function insertResult(value: number) {
    const text = plainResult(value);
    setError(null);
    const last = expr[expr.length - 1];
    if (fresh || expr === "") {
      setExpr(text);
      setFresh(true);
    } else if (isOp(last) || last === "(") {
      setExpr(expr + text);
    }
    panelRef.current?.focus();
  }

  function copy() {
    const value = fresh ? Number(expr) : preview;
    if (value === null || !Number.isFinite(value)) return;
    const text = plainResult(value);
    const done = () => showToast(`Copied ${formatResult(value)}`, "success", 2000);
    const failed = () => showToast("Could not copy. Select the number and copy it instead.", "warning");
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, failed);
    else failed();
  }

  const shown = error ?? (expr === "" ? "0" : preview !== null ? formatResult(preview) : "…");
  const canCopy = expr !== "" && (fresh ? Number.isFinite(Number(expr)) : preview !== null);

  return (
    <span className="ae-typing-wrap ae-calc-wrap no-print" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="ae-header-search-btn"
        onClick={() => {
          if (open) {
            close(false);
          } else {
            userOpened.current = true;
            setOpen(true);
          }
        }}
        aria-label="Calculator"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
      >
        <CalculatorIcon />
      </button>
      {/* Shown by CSS on hover / keyboard focus of the button; the button's aria-label is its name. */}
      {!open && (
        <span className="ae-typing-tip no-print" aria-hidden="true">
          Calculator
          <span className="ae-typing-tip-sub">Quick sums while you work</span>
        </span>
      )}
      {open && (
        <div
          id={popId}
          ref={panelRef}
          className="ae-calc-pop"
          // Not role="dialog": this is a non-modal panel that can stay open while the page is used (and
          // across pages), and the entry grid switches its Delete / Ctrl+C / Esc shortcuts off whenever
          // a dialog is on screen.
          role="group"
          aria-label="Calculator"
          tabIndex={-1}
          onKeyDown={onPanelKeyDown}
        >
          <div className="ae-calc-display">
            <div className="ae-calc-expr" dir="rtl">
              <bdi>{expr === "" ? " " : prettyExpression(expr)}</bdi>
            </div>
            <div className="ae-calc-main">
              <span className={`ae-calc-result${error ? " ae-calc-result--error" : ""}`}>{shown}</span>
              <button type="button" className="ae-calc-copy" onClick={copy} disabled={!canCopy} aria-label="Copy the answer" title="Copy the answer">
                Copy
              </button>
            </div>
          </div>
          <div className="ae-calc-keys">
            {KEYS.map((k) => (
              <button
                key={k.name}
                type="button"
                className={`ae-calc-key${k.kind ? ` ae-calc-key--${k.kind}` : ""}`}
                aria-label={k.name}
                onClick={() => press(k.send)}
              >
                {k.label}
              </button>
            ))}
            <button type="button" className="ae-calc-key ae-calc-key--eq" aria-label="Equals" onClick={() => press("=")}>
              =
            </button>
          </div>
          {history.length > 0 && (
            <div className="ae-calc-history">
              <div className="ae-calc-history-head">
                <span>Recent</span>
                <button
                  type="button"
                  className="ae-calc-link"
                  aria-label="Clear history"
                  onClick={() => {
                    setHistory([]);
                    writeHistory([]);
                  }}
                >
                  Clear
                </button>
              </div>
              <ul>
                {history.slice(0, 4).map((h, i) => (
                  <li key={`${h.e}=${h.r}:${i}`}>
                    <button
                      type="button"
                      className="ae-calc-hist-item"
                      title="Use this answer"
                      onClick={() => insertResult(h.r)}
                    >
                      <span className="ae-calc-hist-expr">{prettyExpression(h.e)}</span>
                      <span className="ae-calc-hist-res">= {formatResult(h.r)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <span className="ae-calc-sr" role="status" aria-live="polite">
            {announce}
          </span>
        </div>
      )}
    </span>
  );
}
