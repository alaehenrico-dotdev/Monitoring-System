import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KeyboardIcon } from "./icons";
import {
  computeStats,
  keyForChar,
  keyIdFromEvent,
  KEY_ROWS,
  MODES,
  generatePassage,
  type TypingMode,
} from "../utils/typingTest";

const BEST_KEY = "ae:typing-best-wpm";

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeBest(wpm: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(wpm));
  } catch {
    /* storage unavailable - best score just isn't remembered */
  }
}

/// Header button + dialog for typing practice. The clock starts on the first
/// keystroke and stops when the passage is fully typed.
export function TypingPractice() {
  const [open, setOpen] = useState(false);
  const [passage, setPassage] = useState(() => generatePassage("mix"));
  const [mode, setMode] = useState<TypingMode>("mix");
  const [typed, setTyped] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [best, setBest] = useState(readBest);
  // Keys physically held down right now, and the last wrong keystroke (flashes red).
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const [wrongKey, setWrongKey] = useState<string | null>(null);
  // Floating window: position, in-flight drag offset, and a brief shake on a typo.
  const [pos, setPos] = useState({ x: 0, y: 72 });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const [shake, setShake] = useState(false);
  // The "Try Typing test!" speech bubble pops up now and then while the window is closed.
  const [nudge, setNudge] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const done = typed.length >= passage.length;
  const elapsed = startedAt === null ? 0 : Math.max(now - startedAt, 0);
  const stats = computeStats(passage, typed, elapsed);

  const reset = useCallback(
    (next?: boolean) => {
      setPassage((p) => (next ? generatePassage(mode, p) : p));
      setTyped("");
      setStartedAt(null);
      setNow(0);
      inputRef.current?.focus();
    },
    [mode],
  );

  const close = useCallback(() => {
    setOpen(false);
    returnFocusRef.current?.focus();
  }, []);

  function openDialog() {
    setNudge(false);
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    // A fresh passage on every open, not whatever was left over from last time.
    setPassage((p) => generatePassage(mode, p));
    setTyped("");
    setStartedAt(null);
    setNow(0);
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

  // Live timer while a run is in progress.
  useEffect(() => {
    if (!open || startedAt === null || done) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [open, startedAt, done]);

  function applyTyped(raw: string) {
    if (done) return;
    const value = raw.slice(0, passage.length);
    const t = Date.now();
    if (startedAt === null && value.length > 0) setStartedAt(t);
    setNow(t);
    // A wrong character flashes the key that was pressed in red.
    if (value.length > typed.length) {
      const i = value.length - 1;
      const bad = value[i] !== passage[i];
      setWrongKey(bad ? (keyForChar(value[i])?.id ?? null) : null);
      if (bad) {
        setShake(true);
        window.setTimeout(() => setShake(false), 220);
      }
    } else setWrongKey(null);
    setTyped(value);
    // Run complete: keep a new personal best (done in the handler, not an effect, so no extra render).
    if (value.length >= passage.length) {
      const wpm = computeStats(passage, value, t - (startedAt ?? t)).wpm;
      if (wpm > best) {
        setBest(wpm);
        writeBest(wpm);
      }
    }
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    applyTyped(e.target.value);
  }

  function onKeyUp(e: React.KeyboardEvent) {
    const id = keyIdFromEvent(e);
    if (!id) return;
    setHeld((h) => {
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
    } else if (e.key === "Tab") {
      e.preventDefault();
      reset(true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      reset(true);
    }
  }

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
                inputRef.current?.focus();
              }}
            />
            <div
              className={`ae-typing-float no-print${shake ? " ae-typing-float--shake" : ""}`}
              style={{ left: pos.x, top: pos.y }}
              role="dialog"
              aria-label="Typing practice"
            >
              <div
                className="ae-typing-progress"
                style={{
                  transform: `scaleX(${typed.length / passage.length})`,
                }}
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
                    setPos({
                      x: Math.min(
                        Math.max(e.clientX - d.dx, 8 - 600),
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
                    inputRef.current?.focus();
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
                      onClick={() => {
                        setMode(m.id);
                        setPassage((p) => generatePassage(m.id, p));
                        setTyped("");
                        setStartedAt(null);
                        setNow(0);
                        setWrongKey(null);
                        inputRef.current?.focus();
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <div
                  className="ae-typing-passage"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    inputRef.current?.focus();
                  }}
                  aria-hidden="true"
                >
                  {passage.split("").map((ch, i) => {
                    let cls = "ae-typing-ch";
                    if (i < typed.length)
                      cls +=
                        typed[i] === ch
                          ? " ae-typing-ch--ok"
                          : " ae-typing-ch--bad";
                    else if (i === typed.length) cls += " ae-typing-ch--cur";
                    return (
                      <span key={i} className={cls}>
                        {ch}
                      </span>
                    );
                  })}
                </div>
                <input
                  ref={inputRef}
                  className="ae-typing-input"
                  type="text"
                  value={typed}
                  onChange={onChange}
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
                <div
                  className={`ae-typing-stats${done ? " ae-typing-stats--done" : ""}`}
                  aria-live="polite"
                >
                  <span>{stats.wpm} WPM</span>
                  <span>{stats.accuracy}% accuracy</span>
                  <span>{(elapsed / 1000).toFixed(1)}s</span>
                </div>
                <div className="ae-kbd" aria-hidden="true">
                  {KEY_ROWS.map((row, r) => (
                    <div className="ae-kbd-row" key={r}>
                      {row.map((k) => {
                        const nextCh = done ? undefined : passage[typed.length];
                        const next =
                          nextCh === undefined ? null : keyForChar(nextCh);
                        const isNext =
                          !!next &&
                          (next.id === k.id ||
                            (next.shift && k.id.startsWith("Shift")));
                        const shiftHeld =
                          held.has("ShiftLeft") || held.has("ShiftRight");
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
                            onClick={() => {
                              if (k.id === "Backspace")
                                applyTyped(typed.slice(0, -1));
                              else if (k.id === "Tab") reset(true);
                              else if (k.type !== undefined)
                                applyTyped(
                                  typed +
                                    (shiftHeld && k.shift ? k.shift : k.type),
                                );
                            }}
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
                <div className="ae-typing-foot">
                  {done ? (
                    <span>Done! Press Enter for a new passage.</span>
                  ) : (
                    <span>
                      Start typing to begin · Enter or Tab = new passage · Esc =
                      close
                    </span>
                  )}
                  <button
                    type="button"
                    className="ae-typing-restart"
                    onClick={() => reset(done)}
                  >
                    {done ? "Next" : "Restart"}
                  </button>
                </div>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
