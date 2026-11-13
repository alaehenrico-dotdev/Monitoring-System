import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KeyboardIcon } from "./icons";
import {
  computeStats,
  continueText,
  generatePassage,
  isTimed,
  keyForChar,
  keyIdFromEvent,
  KEY_ROWS,
  MODES,
  TIMED_SECONDS,
  TIMER_OPTIONS,
  type KeyDef,
  type TypingMode,
} from "../utils/typingTest";

const BEST_KEY = "ae:typing-best-wpm";
const SECONDS_KEY = "ae:typing-seconds";

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function readSeconds(): number {
  try {
    const n = Number(localStorage.getItem(SECONDS_KEY));
    return TIMER_OPTIONS.includes(n) ? n : TIMED_SECONDS;
  } catch {
    return TIMED_SECONDS;
  }
}

/// Storage can be unavailable (private window, blocked site data): nothing is remembered then.
function remember(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* not remembered */
  }
}

interface RunResult {
  wpm: number;
  accuracy: number;
  correct: number;
  errors: number;
  typed: number;
  ms: number;
  isBest: boolean;
  prevBest: number;
}

/// The passage, colour-coded. Memoized so the clock's ticks (which re-render the parent
/// several times a second) don't repaint hundreds of character spans.
const Passage = memo(function Passage({
  passage,
  typed,
  boxRef,
  onFocus,
}: {
  passage: string;
  typed: string;
  boxRef: React.RefObject<HTMLDivElement>;
  onFocus: () => void;
}) {
  return (
    <div
      ref={boxRef}
      className="ae-typing-passage"
      onMouseDown={(e) => {
        e.preventDefault();
        onFocus();
      }}
      aria-hidden="true"
    >
      {passage.split("").map((ch, i) => {
        let cls = "ae-typing-ch";
        if (i < typed.length)
          cls += typed[i] === ch ? " ae-typing-ch--ok" : " ae-typing-ch--bad";
        else if (i === typed.length) cls += " ae-typing-ch--cur";
        return (
          <span key={i} className={cls}>
            {ch}
          </span>
        );
      })}
    </div>
  );
});

/// The on-screen keyboard. Memoized on primitives and stable callbacks for the same reason.
const Keyboard = memo(function Keyboard({
  nextId,
  nextShift,
  held,
  wrongKey,
  onKey,
}: {
  nextId: string | null;
  nextShift: boolean;
  held: ReadonlySet<string>;
  wrongKey: string | null;
  onKey: (k: KeyDef) => void;
}) {
  const shiftHeld = held.has("ShiftLeft") || held.has("ShiftRight");
  return (
    <div className="ae-kbd" aria-hidden="true">
      {KEY_ROWS.map((row, r) => (
        <div className="ae-kbd-row" key={r}>
          {row.map((k) => {
            const isNext =
              nextId !== null &&
              (nextId === k.id || (nextShift && k.id.startsWith("Shift")));
            let cls = "ae-kbd-key";
            if (isNext) cls += " ae-kbd-key--next";
            if (held.has(k.id)) cls += " ae-kbd-key--down";
            if (wrongKey === k.id) cls += " ae-kbd-key--bad";
            return (
              <button
                key={k.id}
                type="button"
                tabIndex={-1}
                className={cls}
                style={{ flexGrow: k.w, flexBasis: 0 }}
                // Keep focus in the hidden input so clicking never drops typing.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onKey(k)}
              >
                {shiftHeld && k.shift
                  ? k.shift
                  : k.id === "Space"
                    ? "space"
                    : k.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
});

/// Shown over the window when a run ends: the timer running out, or a passage being finished.
function ResultDialog({
  result,
  timed,
  seconds,
  onAgain,
  onClose,
}: {
  result: RunResult;
  timed: boolean;
  seconds: number;
  onAgain: () => void;
  onClose: () => void;
}) {
  return (
    <div className="ae-typing-result" role="status">
      <div className="ae-typing-result-card">
        <h3>{timed ? "Time's up!" : "Nicely done!"}</h3>
        <div className="ae-typing-result-wpm">
          <strong>{result.wpm}</strong>
          <span>WPM</span>
          {result.isBest && (
            <em className="ae-typing-result-badge">New best!</em>
          )}
        </div>
        <dl className="ae-typing-result-grid">
          <div>
            <dt>Accuracy</dt>
            <dd>{result.accuracy}%</dd>
          </div>
          <div>
            <dt>Correct</dt>
            <dd>{result.correct}</dd>
          </div>
          <div>
            <dt>Errors</dt>
            <dd>{result.errors}</dd>
          </div>
          <div>
            <dt>{timed ? "Timer" : "Time"}</dt>
            <dd>
              {timed ? `${seconds}s` : `${(result.ms / 1000).toFixed(1)}s`}
            </dd>
          </div>
        </dl>
        <p className="ae-typing-result-best">
          {result.isBest
            ? result.prevBest > 0
              ? `Up from ${result.prevBest} WPM.`
              : "Your first score."
            : `Personal best: ${result.prevBest} WPM`}
        </p>
        <div className="ae-typing-result-actions">
          <button
            type="button"
            className="ae-typing-restart"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="button"
            className="ae-typing-result-primary"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onAgain}
          >
            Try again (Enter)
          </button>
        </div>
      </div>
    </div>
  );
}

/// Header button + floating dialog for typing practice. The clock starts on the first
/// keystroke. Paragraphs is a timed, continuous test (15/30/60/120 seconds); every other
/// mode ends when its short passage is typed. Either way a results dialog appears at the end.
export function TypingPractice() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<TypingMode>("mix");
  const [seconds, setSeconds] = useState(readSeconds);
  const [passage, setPassage] = useState(() => generatePassage("mix"));
  const [typed, setTyped] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [best, setBest] = useState(readBest);
  // Keys physically held down right now, and the last wrong keystroke (flashes red).
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const [wrongKey, setWrongKey] = useState<string | null>(null);
  // Floating window: position, and a brief shake on a typo.
  const [pos, setPos] = useState({ x: 0, y: 72 });
  const [shake, setShake] = useState(false);
  // The "Try Typing test!" speech bubble pops up now and then while the window is closed.
  const [nudge, setNudge] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const passageRef = useRef<HTMLDivElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const shakeTimer = useRef<number | undefined>(undefined);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const timed = isTimed(mode);
  const limitMs = seconds * 1000;
  const done = result !== null;
  const elapsed =
    result?.ms ??
    (startedAt === null
      ? 0
      : Math.max(
          timed ? Math.min(now - startedAt, limitMs) : now - startedAt,
          0,
        ));
  const stats = computeStats(passage, typed, elapsed);

  // What timer callbacks and the stable key handler need, without re-creating them per keystroke.
  const latest = useRef({
    passage,
    typed,
    best,
    held,
    timed,
    limitMs,
    startedAt,
    done,
  });
  useEffect(() => {
    latest.current = {
      passage,
      typed,
      best,
      held,
      timed,
      limitMs,
      startedAt,
      done,
    };
  });

  const focusInput = useCallback(() => inputRef.current?.focus(), []);

  /// Ends the run: scores it, remembers a new best, and brings up the results dialog.
  const finish = useCallback((finalTyped: string, ms: number) => {
    const run = latest.current;
    if (run.done) return;
    const s = computeStats(run.passage, finalTyped, ms);
    const isBest = s.wpm > run.best;
    if (isBest) {
      setBest(s.wpm);
      remember(BEST_KEY, s.wpm);
    }
    setTyped(finalTyped);
    setResult({
      wpm: s.wpm,
      accuracy: s.accuracy,
      correct: s.correct,
      errors: s.typed - s.correct,
      typed: s.typed,
      ms,
      isBest,
      prevBest: run.best,
    });
  }, []);

  /// A fresh run: new passage (for the given mode), cleared state, focus back in the typing box.
  const newRun = useCallback((forMode: TypingMode) => {
    setMode(forMode);
    setPassage((p) => generatePassage(forMode, p));
    setTyped("");
    setStartedAt(null);
    setNow(0);
    setResult(null);
    setWrongKey(null);
    inputRef.current?.focus();
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setHeld(new Set());
    returnFocusRef.current?.focus();
  }, []);

  function openDialog() {
    setNudge(false);
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    newRun(mode); // a fresh passage on every open, not what was left over from last time
    setPos({
      x: Math.max(
        (window.innerWidth - Math.min(760, window.innerWidth - 16)) / 2,
        8,
      ),
      y: 72,
    });
    setOpen(true);
  }

  // Random schedule: first hint after 10-30s, then every 45-120s, each shown for 6s.
  // Skipped while the window is open (and the timers are cleaned up on open/unmount).
  useEffect(() => {
    if (open) return;
    let showTimer: number | undefined;
    let hideTimer: number | undefined;
    const schedule = (minMs: number, maxMs: number) => {
      showTimer = window.setTimeout(
        () => {
          setNudge(true);
          hideTimer = window.setTimeout(() => {
            setNudge(false);
            schedule(45_000, 120_000);
          }, 6000);
        },
        minMs + Math.random() * (maxMs - minMs),
      );
    };
    schedule(10_000, 30_000);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
      setNudge(false);
    };
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => () => window.clearTimeout(shakeTimer.current), []);

  // Long passages scroll inside their box so the next character stays in view.
  useEffect(() => {
    const box = passageRef.current;
    const cur = box?.querySelector<HTMLElement>(".ae-typing-ch--cur");
    if (!box || !cur) return;
    const top = cur.offsetTop;
    if (
      top < box.scrollTop ||
      top + cur.offsetHeight > box.scrollTop + box.clientHeight
    )
      box.scrollTop = Math.max(top - cur.offsetHeight, 0);
  }, [typed.length, passage]);

  // While a run is going: a light tick for the live stats, and an exact timeout for the
  // end of a timed run (so it stops on the second, not up to a tick late).
  useEffect(() => {
    if (!open || startedAt === null || done) return;
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    let end: number | undefined;
    if (timed)
      end = window.setTimeout(
        () => finish(latest.current.typed, limitMs),
        Math.max(limitMs - (Date.now() - startedAt), 0),
      );
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(end);
    };
  }, [open, startedAt, done, timed, limitMs, finish]);

  function applyTyped(raw: string) {
    const run = latest.current;
    if (run.done) return;
    const t = Date.now();
    if (
      run.timed &&
      run.startedAt !== null &&
      t - run.startedAt >= run.limitMs
    ) {
      finish(run.typed, run.limitMs); // the clock ran out between ticks: this key doesn't count
      return;
    }
    const value = raw.slice(0, run.passage.length);
    if (run.startedAt === null && value.length > 0) setStartedAt(t);
    setNow(t);
    // A wrong character flashes the key that was pressed in red, and the window shakes.
    if (value.length > run.typed.length) {
      const i = value.length - 1;
      const bad = value[i] !== run.passage[i];
      setWrongKey(bad ? (keyForChar(value[i])?.id ?? null) : null);
      if (bad) {
        setShake(true);
        window.clearTimeout(shakeTimer.current);
        shakeTimer.current = window.setTimeout(() => setShake(false), 220);
      }
    } else setWrongKey(null);
    setTyped(value);
    if (run.timed) {
      // Continuous text: top it up well before the typist reaches the end.
      if (value.length > run.passage.length - 250)
        setPassage((p) => `${p} ${continueText()}`);
    } else if (value.length >= run.passage.length) {
      finish(value, t - (run.startedAt ?? t));
    }
  }
  const applyRef = useRef(applyTyped);
  useEffect(() => {
    applyRef.current = applyTyped;
  });

  // Stable across renders so the memoized keyboard isn't repainted by the clock.
  const onScreenKey = useCallback(
    (k: KeyDef) => {
      const { typed: cur, held: h } = latest.current;
      if (k.id === "Backspace") applyRef.current(cur.slice(0, -1));
      else if (k.id === "Tab") newRun(mode);
      else if (k.type !== undefined) {
        const shift = h.has("ShiftLeft") || h.has("ShiftRight");
        applyRef.current(cur + (shift && k.shift ? k.shift : k.type));
      }
    },
    [mode, newRun],
  );

  function onKeyUp(e: React.KeyboardEvent) {
    const id = keyIdFromEvent(e);
    if (!id) return;
    setHeld((h) => {
      if (!h.has(id)) return h;
      const n = new Set(h);
      n.delete(id);
      return n;
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const id = keyIdFromEvent(e);
    if (id) setHeld((h) => (h.has(id) ? h : new Set(h).add(id)));
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      newRun(mode);
    }
  }

  const nextCh = done ? undefined : passage[typed.length];
  const next = nextCh === undefined ? null : keyForChar(nextCh);
  const progress = timed ? elapsed / limitMs : typed.length / passage.length;

  return (
    <>
      <span className="ae-typing-wrap">
        <button
          type="button"
          className="ae-header-search-btn ae-typing-btn"
          onClick={openDialog}
          aria-label="Typing practice"
          title="Typing practice"
        >
          <KeyboardIcon />
        </button>
        {nudge && !open && (
          <button
            type="button"
            className="ae-typing-nudge no-print"
            aria-hidden="true"
            tabIndex={-1}
            onClick={openDialog}
          >
            Try Typing test!
          </button>
        )}
      </span>
      {open &&
        createPortal(
          <>
            {/* Blurs the page while practising; clicking it just returns focus to the typing box. */}
            <div
              className="ae-typing-backdrop no-print"
              aria-hidden="true"
              onMouseDown={(e) => {
                e.preventDefault();
                focusInput();
              }}
            />
            <div
              ref={floatRef}
              className={`ae-typing-float no-print${shake ? " ae-typing-float--shake" : ""}`}
              style={{ left: pos.x, top: pos.y }}
              role="dialog"
              aria-label="Typing practice"
            >
              <div
                className="ae-typing-progress"
                style={{ transform: `scaleX(${Math.min(progress, 1)})` }}
              />
              <div className="ae-typing-inner">
                <div
                  className="ae-typing-head"
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest("button")) return;
                    dragRef.current = {
                      dx: e.clientX - pos.x,
                      dy: e.clientY - pos.y,
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    const d = dragRef.current;
                    if (!d) return;
                    // Keep at least a grabbable strip of the window on screen.
                    const w = floatRef.current?.offsetWidth ?? 760;
                    setPos({
                      x: Math.min(
                        Math.max(e.clientX - d.dx, 80 - w),
                        window.innerWidth - 80,
                      ),
                      y: Math.min(
                        Math.max(e.clientY - d.dy, 0),
                        window.innerHeight - 40,
                      ),
                    });
                  }}
                  onPointerUp={() => {
                    dragRef.current = null;
                    focusInput();
                  }}
                  onPointerCancel={() => {
                    dragRef.current = null;
                  }}
                >
                  <strong>Typing practice</strong>
                  <span className="ae-typing-best">Best: {best} WPM</span>
                  <button
                    type="button"
                    className="ae-typing-close"
                    onClick={close}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
                <div
                  className="ae-typing-modes"
                  role="group"
                  aria-label="Passage type"
                >
                  {MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`ae-typing-mode${m.id === mode ? " ae-typing-mode--on" : ""}`}
                      aria-pressed={m.id === mode}
                      // Keep focus in the hidden input so typing isn't interrupted.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => newRun(m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                  {timed && (
                    <span
                      className="ae-typing-timer"
                      role="group"
                      aria-label="Timer length"
                    >
                      {TIMER_OPTIONS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          className={`ae-typing-mode${s === seconds ? " ae-typing-mode--on" : ""}`}
                          aria-pressed={s === seconds}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setSeconds(s);
                            remember(SECONDS_KEY, s);
                            newRun("paragraphs");
                          }}
                        >
                          {s}s
                        </button>
                      ))}
                    </span>
                  )}
                </div>
                <Passage
                  passage={passage}
                  typed={typed}
                  boxRef={passageRef}
                  onFocus={focusInput}
                />
                <input
                  ref={inputRef}
                  className="ae-typing-input"
                  type="text"
                  value={typed}
                  onChange={(e) => applyTyped(e.target.value)}
                  onKeyDown={onKeyDown}
                  onKeyUp={onKeyUp}
                  onBlur={() => setHeld(new Set())}
                  aria-label="Type the passage shown above"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  readOnly={done}
                />
                <div className="ae-typing-stats">
                  <span>{stats.wpm} WPM</span>
                  <span>{stats.accuracy}% accuracy</span>
                  <span>
                    {timed
                      ? `${Math.max(Math.ceil((limitMs - elapsed) / 1000), 0)}s left`
                      : `${(elapsed / 1000).toFixed(1)}s`}
                  </span>
                </div>
                <Keyboard
                  nextId={next?.id ?? null}
                  nextShift={next?.shift ?? false}
                  held={held}
                  wrongKey={wrongKey}
                  onKey={onScreenKey}
                />
                <div className="ae-typing-foot">
                  <span>
                    {timed && startedAt === null
                      ? `${seconds}s timer starts on your first key`
                      : "Start typing to begin"}{" "}
                    · Enter or Tab = new test · Esc = close
                  </span>
                  <button
                    type="button"
                    className="ae-typing-restart"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => newRun(mode)}
                  >
                    Restart
                  </button>
                </div>
              </div>
              {result && (
                <ResultDialog
                  result={result}
                  timed={timed}
                  seconds={seconds}
                  onAgain={() => newRun(mode)}
                  onClose={close}
                />
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
