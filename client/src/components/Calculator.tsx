import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CalculatorIcon } from "./icons";
import { useReadOnlyPhone } from "../hooks/useReadOnlyPhone";
import { showToast } from "./Toast";
import {
  copyText,
  evaluate,
  formatWith,
  packSplit,
  parseNumberList,
  plainResult,
  prettyExpression,
  sumLines,
  TAPE_MAX,
  type FormatOptions,
} from "../utils/calculator";

/// A small calculator in the header, next to the typing practice: an icon (or Alt+C) that opens a panel
/// under it. For the sums that come up while entering stock (packs to pieces, a total of several counts,
/// a percentage) without leaving the page or reaching for a phone. It NEVER touches the sheet: nothing
/// typed, pasted or copied in it reaches the page's own shortcuts, and it has no way to write a cell.
///
/// Works with the mouse (the keypad) or the keyboard alone: digits and . + - * / x ( ) % type,
/// Enter or = calculates, Backspace deletes, C or Delete clears, Esc closes. Shows the answer as you
/// type, keeps the last 20 calculations (pin the ones you reuse), and copies the answer.
///   - Tape: an adding-machine list. Type a number, Add; the total is kept. Paste a column of numbers
///     to total it.
///   - Memory (MC MR M+ M-) and Ans carry an answer into the next sum.
///   - A pack converter turns pieces into packs (with what is left over) and back.
///   - Decimals and thousands separators for the display and the copied text.
/// Not on the read-only mobile views (a phone, a tablet, a half-folded foldable): there is no sheet to
/// do sums for there, so it is not shown and Alt+C does nothing.
/// The arithmetic is utils/calculator.ts: a hand-written parser, never eval.

const HISTORY_KEY = "ae:calc-history";
const HISTORY_MAX = 20;

interface Entry {
  e: string;
  r: number;
  /// Pinned: kept at the top and never pushed out by newer calculations.
  pin?: boolean;
}

function readHistory(): Entry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((x): x is Entry => !!x && typeof x.e === "string" && typeof x.r === "number" && Number.isFinite(x.r))
      .map((x) => (x.pin === true ? { e: x.e, r: x.r, pin: true } : { e: x.e, r: x.r }))
      .slice(0, HISTORY_MAX * 2);
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

/// Pinned entries first, then the newest others up to the limit.
function arrange(all: Entry[]): Entry[] {
  return [...all.filter((x) => x.pin), ...all.filter((x) => !x.pin).slice(0, HISTORY_MAX)];
}

/// How answers are shown, and the pack size: small settings kept on this device.
const FMT_KEY = "ae:calc-fmt";
const PACK_KEY = "ae:calc-pack";

type Fmt = { decimals: number | null; grouping: boolean };

function readFmt(): Fmt {
  try {
    const raw = JSON.parse(localStorage.getItem(FMT_KEY) ?? "null") as Partial<Fmt> | null;
    const decimals = raw?.decimals;
    return {
      decimals: decimals === 0 || decimals === 1 || decimals === 2 || decimals === 3 ? decimals : null,
      grouping: raw?.grouping !== false,
    };
  } catch {
    return { decimals: null, grouping: true };
  }
}

function readPack(): string {
  try {
    const v = localStorage.getItem(PACK_KEY) ?? "";
    return /^[0-9]*\.?[0-9]*$/.test(v) && v.length <= 8 ? v : "";
  } catch {
    return "";
  }
}

function saveSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not remembered */
  }
}

/// The sum in progress, the tape, the memory and whether the panel is open, kept for this browser tab so
/// that going to another page (each page draws its own header, which resets this component) doesn't lose
/// them. sessionStorage, not localStorage: a new tab or a new visit starts clean.
const STATE_KEY = "ae:calc-state";

type Mode = "calc" | "tape";

interface Saved {
  open: boolean;
  expr: string;
  fresh: boolean;
  mode: Mode;
  tape: number[];
  mem: number | null;
}

const CLEAN: Saved = { open: false, expr: "", fresh: false, mode: "calc", tape: [], mem: null };

function readSaved(): Saved {
  try {
    const raw = JSON.parse(sessionStorage.getItem(STATE_KEY) ?? "null") as Partial<Saved> | null;
    // Only what the keypad can produce: a stored value is never trusted as anything else.
    if (raw && typeof raw.expr === "string" && raw.expr.length <= 200 && /^[0-9.+\-*/()%]*$/.test(raw.expr)) {
      const tape = Array.isArray(raw.tape) ? raw.tape.filter((n): n is number => typeof n === "number" && Number.isFinite(n)).slice(0, TAPE_MAX) : [];
      return {
        open: raw.open === true,
        expr: raw.expr,
        fresh: raw.fresh === true && raw.expr !== "",
        mode: raw.mode === "tape" ? "tape" : "calc",
        tape,
        mem: typeof raw.mem === "number" && Number.isFinite(raw.mem) ? raw.mem : null,
      };
    }
  } catch {
    /* unreadable or blocked: start clean */
  }
  return CLEAN;
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

const tidy = (n: number) => Number(n.toPrecision(12));

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

const DECIMAL_CHOICES: (number | null)[] = [null, 0, 1, 2, 3];

/// The tape's lines. Memoised: while a number is being typed only the display changes, so a tape of a
/// few hundred lines is not re-rendered (or re-formatted) on every key.
const TapeLines = memo(function TapeLines({
  lines,
  fmt,
  onRemove,
  listRef,
}: {
  lines: number[];
  fmt: Fmt;
  onRemove: (index: number) => void;
  listRef: React.RefObject<HTMLOListElement>;
}) {
  return (
    <ol className="ae-calc-tape-lines" ref={listRef} aria-label="Tape lines">
      {lines.map((n, i) => (
        <li key={i}>
          <span className="ae-calc-tape-n">{i + 1}</span>
          <span className="ae-calc-tape-v">{formatWith(n, fmt as FormatOptions)}</span>
          <button type="button" className="ae-calc-tape-x" aria-label={`Remove line ${i + 1}`} onClick={() => onRemove(i)}>
            ×
          </button>
        </li>
      ))}
    </ol>
  );
});

export function HeaderCalculator() {
  const phone = useReadOnlyPhone();
  // Read once, on mount, so a page change brings back the sum, the tape, the memory and the open panel.
  const [saved] = useState(readSaved);
  const [open, setOpen] = useState(saved.open);
  const [expr, setExpr] = useState(saved.expr);
  /// The answer was just calculated: the next digit starts fresh, the next operator carries on from it.
  const [fresh, setFresh] = useState(saved.fresh);
  const [mode, setMode] = useState<Mode>(saved.mode);
  const [tape, setTape] = useState<number[]>(saved.tape);
  const [mem, setMem] = useState<number | null>(saved.mem);
  /// Focus moves into the panel only when the person opens it, not when it comes back on a new page
  /// (that would pull focus out of whatever they were typing in).
  const userOpened = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [history, setHistory] = useState<Entry[]>(() => arrange(readHistory()));
  const [ans, setAns] = useState<number | null>(() => readHistory().find((h) => !h.pin)?.r ?? null);
  const [fmt, setFmt] = useState<Fmt>(readFmt);
  const [showFmt, setShowFmt] = useState(false);
  const [packText, setPackText] = useState(readPack);
  const [note, setNote] = useState("");

  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tapeRef = useRef<HTMLOListElement>(null);
  const popId = useId();

  const show = useCallback((n: number) => formatWith(n, fmt as FormatOptions), [fmt]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) btnRef.current?.focus();
  }, []);

  useEffect(() => {
    writeSaved({ open, expr, fresh, mode, tape, mem });
  }, [open, expr, fresh, mode, tape, mem]);

  // Open: focus the panel so the keyboard works at once. Click outside closes it.
  useEffect(() => {
    if (!open) return;
    if (userOpened.current) panelRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Alt+C opens and closes it from anywhere on the page (inside the panel, onPanelKeyDown handles it).
  useEffect(() => {
    if (phone) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== "KeyC") return;
      e.preventDefault();
      if (open) {
        close(true);
      } else {
        userOpened.current = true;
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close, phone]);

  // A new tape line scrolls into view.
  useEffect(() => {
    const el = tapeRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tape.length]);

  // What the display shows while typing: the answer so far, ignoring a dangling operator and
  // closing any open brackets, so "12*(3+" already shows 12*3 = 36.
  const preview = useMemo(() => {
    const s = completed(expr);
    if (s === "") return null;
    const r = evaluate(s);
    return r.ok ? r.value : null;
  }, [expr]);

  /// The number on the display right now (a finished answer, or the sum so far), or null.
  const current = useMemo(() => {
    if (expr === "") return null;
    if (fresh) return Number.isFinite(Number(expr)) ? Number(expr) : null;
    return preview;
  }, [expr, fresh, preview]);

  const total = useMemo(() => sumLines(tape), [tape]);
  const removeLine = useCallback((index: number) => setTape((t) => t.filter((_, j) => j !== index)), []);

  const addHistory = useCallback((entry: Entry) => {
    setHistory((h) => {
      const next = arrange([entry, ...h]);
      writeHistory(next);
      return next;
    });
  }, []);

  const press = useCallback(
    (key: string) => {
      setError(null);
      setNote("");
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
        if (mode === "tape") {
          // On the tape, "=" adds the number (or the sum typed) as a new line.
          const next = [...tape, r.value].slice(-TAPE_MAX);
          setTape(next);
          setExpr("");
          setFresh(false);
          setAnnounce(`Added ${show(r.value)}. Total ${show(sumLines(next))}`);
          return;
        }
        // A lone number has nothing to calculate: leave it be, don't log "5 = 5".
        if (!/^-?[\d.]+$/.test(expr)) addHistory({ e: expr, r: r.value });
        setAns(r.value);
        setExpr(plainResult(r.value));
        setFresh(true);
        setAnnounce(`${prettyExpression(expr)} equals ${show(r.value)}`);
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
    [expr, fresh, mode, tape, show, addHistory],
  );

  /// Reuses an answer: it replaces a finished answer or an empty display, and follows an
  /// operator or an open bracket mid-sum. After a digit it does nothing (two numbers can't touch).
  const insertResult = useCallback(
    (value: number) => {
      const text = plainResult(value);
      setError(null);
      setNote("");
      const last = expr[expr.length - 1];
      if (fresh || expr === "") {
        setExpr(text);
        setFresh(true);
      } else if (isOp(last) || last === "(") {
        setExpr(expr + text);
      }
      panelRef.current?.focus();
    },
    [expr, fresh],
  );

  function memoryAdd(sign: 1 | -1) {
    if (current === null) return;
    const next = sumLines([mem ?? 0, sign * current]);
    setMem(next);
    setAnnounce(`Memory ${show(next)}`);
    panelRef.current?.focus();
  }

  // The pack converter: pieces to packs (and what is left over) and back.
  const pack = Number(packText);
  const packOk = packText !== "" && Number.isFinite(pack) && pack > 0;
  function convert(kind: "pcs" | "packs") {
    if (current === null || !packOk) return;
    const value = tidy(kind === "pcs" ? current * pack : current / pack);
    addHistory({ e: `${plainResult(current)}${kind === "pcs" ? "*" : "/"}${plainResult(pack)}`, r: value });
    if (kind === "packs") {
      const split = packSplit(current, pack);
      setNote(split ? (split.rest > 0 ? `${split.packs} packs + ${split.rest} pcs` : `${split.packs} packs`) : "");
    } else {
      setNote("");
    }
    setError(null);
    setAns(value);
    setExpr(plainResult(value));
    setFresh(true);
    panelRef.current?.focus();
  }

  function togglePin(index: number) {
    setHistory((h) => {
      const next = arrange(h.map((x, i) => (i === index ? { ...x, pin: x.pin ? undefined : true } : x)));
      writeHistory(next);
      return next;
    });
  }

  function chooseFmt(next: Fmt) {
    setFmt(next);
    saveSetting(FMT_KEY, JSON.stringify(next));
  }

  /// Every key typed in the panel is stopped here, so none of them reaches the page's own shortcuts:
  /// the entry grid clears the selected cells on Delete, copies them on Ctrl+C, moves with the arrow
  /// keys and deselects on Esc, from listeners on the whole document. Typing in the calculator must
  /// never do any of that, whether or not the calculator itself uses the key.
  function onPanelKeyDown(e: React.KeyboardEvent) {
    e.stopPropagation();
    const handled = () => e.preventDefault();
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyC") {
      handled();
      close(true);
      return;
    }
    if (e.key === "Escape") {
      handled();
      close(true);
      return;
    }
    // The pack-size field types for itself (digits and a point; the keys above are the calculator's).
    if ((e.target as HTMLElement).tagName === "INPUT") return;
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

  /// Pasting a column of numbers (from a spreadsheet or a chat) totals them on the tape. Handled here
  /// and stopped, so a paste never reaches the entry grid's own paste (which fills the selected cells).
  function onPanelPaste(e: React.ClipboardEvent) {
    e.stopPropagation();
    if ((e.target as HTMLElement).tagName === "INPUT") return; // the pack-size field pastes normally
    e.preventDefault();
    const nums = parseNumberList(e.clipboardData.getData("text"));
    if (nums.length === 0) return;
    setError(null);
    setNote("");
    if (nums.length === 1 && mode === "calc") {
      setExpr(plainResult(nums[0]));
      setFresh(true);
      return;
    }
    const next = [...tape, ...nums].slice(-TAPE_MAX);
    setMode("tape");
    setTape(next);
    setAnnounce(`Added ${nums.length} numbers. Total ${show(sumLines(next))}`);
  }

  function writeClipboard(text: string, message: string) {
    const failed = () => showToast("Could not copy. Select the number and copy it instead.", "warning");
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => showToast(message, "success", 2000), failed);
    else failed();
  }

  function copy() {
    if (current === null || !Number.isFinite(current)) return;
    writeClipboard(copyText(current, fmt.decimals), `Copied ${show(Number(copyText(current, fmt.decimals)))}`);
  }

  // Every hook has run above; on a mobile view there is nothing to show.
  if (phone) return null;

  const shown = error ?? (expr === "" ? "0" : preview !== null ? show(preview) : "…");
  const canCopy = current !== null;
  const eqLabel = mode === "tape" ? "Add" : "=";

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
        aria-keyshortcuts="Alt+C"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
      >
        <CalculatorIcon />
      </button>
      {/* Shown by CSS on hover / keyboard focus of the button; the button's aria-label is its name. */}
      {!open && (
        <span className="ae-typing-tip no-print" aria-hidden="true">
          Calculator
          <span className="ae-typing-tip-sub">Quick sums while you work · Alt+C</span>
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
          onPaste={onPanelPaste}
          onCopy={(e) => e.stopPropagation()}
          onCut={(e) => e.stopPropagation()}
        >
          <div className="ae-calc-tabs">
            <div className="ae-calc-seg" role="group" aria-label="Mode">
              <button type="button" className="ae-calc-tab" aria-pressed={mode === "calc"} onClick={() => setMode("calc")}>
                Calc
              </button>
              <button type="button" className="ae-calc-tab" aria-pressed={mode === "tape"} onClick={() => setMode("tape")}>
                Tape
                {tape.length > 0 && <span className="ae-calc-tab-count">{tape.length}</span>}
              </button>
            </div>
            <button
              type="button"
              className="ae-calc-gear"
              aria-label="Number format"
              aria-expanded={showFmt}
              title="Decimals and thousands separators"
              onClick={() => setShowFmt((s) => !s)}
            >
              ⚙
            </button>
          </div>

          {showFmt && (
            <div className="ae-calc-fmt">
              <div className="ae-calc-seg" role="group" aria-label="Decimals">
                {DECIMAL_CHOICES.map((d) => (
                  <button
                    key={String(d)}
                    type="button"
                    className="ae-calc-tab"
                    aria-pressed={fmt.decimals === d}
                    aria-label={d === null ? "Automatic decimals" : `${d} decimals`}
                    onClick={() => chooseFmt({ ...fmt, decimals: d })}
                  >
                    {d === null ? "Auto" : d}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="ae-calc-tab ae-calc-tab--solo"
                aria-pressed={fmt.grouping}
                aria-label="Thousands separators"
                onClick={() => chooseFmt({ ...fmt, grouping: !fmt.grouping })}
              >
                1,000
              </button>
            </div>
          )}

          <div className="ae-calc-display">
            {mem !== null && (
              <div className="ae-calc-mem" title="Memory (MR recalls it)">
                M {show(mem)}
              </div>
            )}
            <div className="ae-calc-expr" dir="rtl">
              <bdi>{expr === "" ? " " : prettyExpression(expr)}</bdi>
            </div>
            <div className="ae-calc-main">
              <span className={`ae-calc-result${error ? " ae-calc-result--error" : ""}`}>{shown}</span>
              <button type="button" className="ae-calc-copy" onClick={copy} disabled={!canCopy} aria-label="Copy the answer" title="Copy the answer">
                Copy
              </button>
            </div>
            {note && <div className="ae-calc-note">= {note}</div>}
          </div>

          {mode === "tape" && (
            <div className="ae-calc-tape">
              {tape.length === 0 ? (
                <p className="ae-calc-tape-empty">Type a number and press Add. Paste a column of numbers to total it.</p>
              ) : (
                <TapeLines lines={tape} fmt={fmt} onRemove={removeLine} listRef={tapeRef} />
              )}
              <div className="ae-calc-tape-total">
                <span>Total{tape.length > 0 ? ` (${tape.length})` : ""}</span>
                <strong>{show(total)}</strong>
              </div>
              <div className="ae-calc-tape-actions">
                <button
                  type="button"
                  className="ae-calc-link"
                  disabled={tape.length === 0}
                  onClick={() => writeClipboard(copyText(total, fmt.decimals), `Copied ${show(Number(copyText(total, fmt.decimals)))}`)}
                >
                  Copy total
                </button>
                <button
                  type="button"
                  className="ae-calc-link"
                  disabled={tape.length === 0}
                  onClick={() => writeClipboard(tape.map((n) => plainResult(n)).join("\n"), `Copied ${tape.length} lines`)}
                >
                  Copy column
                </button>
                <button type="button" className="ae-calc-link" disabled={tape.length === 0} onClick={() => setTape([])}>
                  Clear tape
                </button>
              </div>
            </div>
          )}

          {mode === "calc" && (
            <div className="ae-calc-memrow">
              <button type="button" className="ae-calc-mkey" aria-label="Memory clear" onClick={() => setMem(null)} disabled={mem === null}>
                MC
              </button>
              <button type="button" className="ae-calc-mkey" aria-label="Memory recall" onClick={() => mem !== null && insertResult(mem)} disabled={mem === null}>
                MR
              </button>
              <button type="button" className="ae-calc-mkey" aria-label="Add to memory" onClick={() => memoryAdd(1)} disabled={current === null}>
                M+
              </button>
              <button type="button" className="ae-calc-mkey" aria-label="Subtract from memory" onClick={() => memoryAdd(-1)} disabled={current === null}>
                M−
              </button>
              <button type="button" className="ae-calc-mkey" aria-label="Last answer" onClick={() => ans !== null && insertResult(ans)} disabled={ans === null}>
                Ans
              </button>
            </div>
          )}

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
            <button
              type="button"
              className="ae-calc-key ae-calc-key--eq"
              aria-label={mode === "tape" ? "Add to tape" : "Equals"}
              onClick={() => press("=")}
            >
              {eqLabel}
            </button>
          </div>

          {mode === "calc" && (
            <div className="ae-calc-pack">
              <label>
                Pack of
                <input
                  className="ae-calc-pack-input"
                  inputMode="decimal"
                  aria-label="Pieces per pack"
                  placeholder="24"
                  maxLength={8}
                  value={packText}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!/^[0-9]*\.?[0-9]*$/.test(v)) return;
                    setPackText(v);
                    saveSetting(PACK_KEY, v);
                  }}
                />
                pcs
              </label>
              <button type="button" className="ae-calc-mkey" aria-label="Packs to pieces" disabled={current === null || !packOk} onClick={() => convert("pcs")}>
                × pcs
              </button>
              <button type="button" className="ae-calc-mkey" aria-label="Pieces to packs" disabled={current === null || !packOk} onClick={() => convert("packs")}>
                ÷ packs
              </button>
            </div>
          )}

          {mode === "calc" && history.length > 0 && (
            <div className="ae-calc-history">
              <div className="ae-calc-history-head">
                <span>Recent</span>
                <button
                  type="button"
                  className="ae-calc-link"
                  aria-label="Clear history"
                  onClick={() => {
                    // Pinned entries stay.
                    const keep = history.filter((h) => h.pin);
                    setHistory(keep);
                    writeHistory(keep);
                  }}
                >
                  Clear
                </button>
              </div>
              <ul>
                {history.map((h, i) => (
                  <li key={`${h.e}=${h.r}:${i}`}>
                    <button type="button" className="ae-calc-hist-item" title="Use this answer" onClick={() => insertResult(h.r)}>
                      <span className="ae-calc-hist-expr">{prettyExpression(h.e)}</span>
                      <span className="ae-calc-hist-res">= {show(h.r)}</span>
                    </button>
                    <button
                      type="button"
                      className={`ae-calc-pin${h.pin ? " is-pinned" : ""}`}
                      aria-pressed={h.pin === true}
                      aria-label={`${h.pin ? "Unpin" : "Pin"} ${prettyExpression(h.e)}`}
                      title={h.pin ? "Unpin" : "Pin: keep this one"}
                      onClick={() => togglePin(i)}
                    >
                      {h.pin ? "★" : "☆"}
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
