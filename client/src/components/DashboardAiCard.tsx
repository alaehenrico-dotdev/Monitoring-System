import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  askData,
  getWhatChanged,
  type AskAnswer,
  type ChangeDelta,
  type ChangeMover,
  type WhatChanged,
} from "../api/ai";
import { Button } from "./ui";
import { Dropdown } from "./Dropdown";
import { colors } from "../theme";
import { formatDateDisplay } from "../utils/dateFormat";
import { describeArgs, TOOL_LABEL } from "../utils/aiSources";
import { AI_PLACEHOLDER, aiFallback } from "../utils/aiFallback";
import { AiNotice } from "./AiNotice";
import { SparklesIcon } from "./icons";
import { loadAiEnabled } from "../hooks/useAiAvailable";

/**
 * Dashboard > "AI insights": two helpers that read the app's own reports.
 *
 *  - "What changed?" compares a window of days with the window just before it. The server
 *    does the arithmetic and the comparison table below is that arithmetic; the AI only
 *    writes the few sentences above it, so every figure it mentions can be checked there.
 *  - "Ask the data" answers a typed question through a small fixed set of read-only
 *    lookups on the server. The lookups used (and the rows they returned) are listed
 *    under each answer.
 *
 * Both are read-only, Supervisor/Admin only and spend nothing until someone clicks. The
 * whole card stays out of the page unless the server says AI is set up, so a deployment
 * without a key looks exactly as it did before. Answers are shown as plain text.
 */

const WINDOWS: { days: number; label: string }[] = [
  { days: 1, label: "Today vs yesterday" },
  { days: 7, label: "Last 7 days vs the 7 before" },
  { days: 14, label: "Last 14 days vs the 14 before" },
  { days: 30, label: "Last 30 days vs the 30 before" },
];

const EXAMPLES = [
  "What needs attention right now?",
  "Which products are running out first?",
  "Which products were short in several audits this month?",
  "Which products moved the most in the last 7 days?",
];

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const signed = (n: number) => (n > 0 ? "+" : "") + fmt(n);
const pct = (d: ChangeDelta) => (d.changePct === null ? (d.current > 0 ? "new" : "") : `${d.changePct > 0 ? "+" : ""}${d.changePct}%`);

export function DashboardAiCard() {
  // null = not known yet; the card renders nothing until the server confirms AI is on.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    // The same cached answer the header search uses, so the dashboard asks the server once, not twice.
    void loadAiEnabled().then((on) => {
      if (!cancelled) setEnabled(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Either helper working: the card's border turns faster, the same "thinking" cue as the header search.
  const [changedBusy, setChangedBusy] = useState(false);
  const [askBusy, setAskBusy] = useState(false);
  // One answer area for both helpers, at the bottom of the card (see AiOut).
  const [outEl, setOutEl] = useState<HTMLDivElement | null>(null);
  const [changedFilled, setChangedFilled] = useState(false);
  const [askFilled, setAskFilled] = useState(false);
  // The answer floats under the card (a popover): it can be closed, and a new answer reopens it.
  const [dismissed, setDismissed] = useState(false);
  const [fresh, setFresh] = useState(0);
  const onFresh = useCallback(() => {
    setDismissed(false);
    setFresh((n) => n + 1);
  }, []);
  const showOut = (changedFilled || askFilled) && !dismissed;
  useEffect(() => {
    // Brings the answer into view if the card sits near the bottom of the screen (the page scrolls, nothing moves).
    if (showOut && outEl && typeof outEl.scrollIntoView === "function") outEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [showOut, outEl, fresh]);
  useEffect(() => {
    if (!showOut) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showOut]);

  // The ring only turns while the card is on screen.
  const cardRef = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);

  if (!enabled) return null;
  return (
    <section className="ae-dash-section ae-dash-ai-slot" aria-label="AI insights">
      <div
        ref={cardRef}
        className={`ae-dash-card ae-dash-ai${changedBusy || askBusy ? " ae-dash-ai--busy" : ""}`}
        data-ring-paused={onScreen ? undefined : "true"}
        style={{ padding: "10px 14px 12px" }}
      >
        {/* The turning seal-coloured ring and the glow round the card's edge (see .ae-ring and
            .ae-dash-ai-glow in dashboard.css). */}
        <span className="ae-ring no-print" aria-hidden="true">
          <i />
        </span>
        <span className="ae-dash-ai-glow no-print" aria-hidden="true">
          <span>
            <i />
          </span>
        </span>
        <div className="ae-dash-ai-head">
          <h3 className="ae-dash-ai-title">
            <SparklesIcon />
            AI insights
          </h3>
          <span style={mutedStyle}>AI-written. Check the numbers before acting.</span>
        </div>
        <div className="ae-dash-ai-grid">
          <WhatChangedPanel onBusy={setChangedBusy} outEl={outEl} onFilled={setChangedFilled} onFresh={onFresh} />
          <AskPanel onBusy={setAskBusy} outEl={outEl} onFilled={setAskFilled} onFresh={onFresh} />
        </div>
        {/* The answers of both helpers float here, under the card: nothing is reserved inside it, so it
            never grows or moves what is under it. Hidden until there is an answer. */}
        <div ref={setOutEl} className="ae-dash-ai-out" role="region" aria-label="Answer" tabIndex={-1} hidden={!showOut}>
          <button type="button" className="ae-dash-ai-out-close" aria-label="Close answer" onClick={() => setDismissed(true)}>
            ×
          </button>
        </div>
      </div>
    </section>
  );
}

type OutProps = { outEl: HTMLDivElement | null; onFilled: (filled: boolean) => void; onFresh: () => void };

function WhatChangedPanel({ onBusy, outEl, onFilled, onFresh }: { onBusy: (busy: boolean) => void } & OutProps) {
  const [days, setDays] = useState(7);
  const [result, setResult] = useState<WhatChanged | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => onBusy(busy), [busy, onBusy]);
  const [error, setError] = useState<unknown>(null);
  // A late answer for a window the person has since left should not replace the current one.
  const latest = useRef(0);

  async function run() {
    const id = ++latest.current;
    setBusy(true);
    setError(null);
    try {
      const r = await getWhatChanged(days);
      if (id === latest.current) setResult(r);
    } catch (e) {
      if (id === latest.current) setError(e);
    } finally {
      if (id === latest.current) setBusy(false);
    }
  }

  const facts = result?.facts;
  return (
    <div aria-label="What changed">
      <div className="ae-dash-ai-row">
        <h4 style={panelHeadingStyle}>What changed?</h4>
        {/* The app's themed dropdown, not a native <select>: the browser's own list is white, in the
            system font and far too large on a phone. */}
        <Dropdown
          aria-label="Comparison window"
          value={String(days)}
          disabled={busy}
          options={WINDOWS.map((w) => ({ value: String(w.days), label: w.label }))}
          onChange={(v) => {
            latest.current++;
            setDays(Number(v));
            setResult(null);
            setError(null);
            setBusy(false);
          }}
        />
        <Button type="button" size="sm" onClick={() => void run()} disabled={busy}>
          {busy ? "Comparing…" : result ? "Refresh" : "Compare"}
        </Button>
      </div>

      <AiOut panel="changed" outEl={outEl} onFilled={onFilled} onFresh={onFresh} signal={result ?? error} filled={error !== null || !!facts}>
        {error !== null && <AiNotice note={aiFallback(error, AI_PLACEHOLDER.changes)} onRetry={() => void run()} busy={busy} />}

        {facts && (
          <>
            <p style={{ ...mutedStyle, margin: "10px 0 0" }}>
              {formatDateDisplay(facts.current.from)} – {formatDateDisplay(facts.current.to)} vs {formatDateDisplay(facts.previous.from)} –{" "}
              {formatDateDisplay(facts.previous.to)}
              {facts.currentWindowMayBePartial && " · latest day may be incomplete"}
            </p>
            {result.explanation ? (
              <p style={{ ...bodyStyle, margin: "8px 0" }}>{result.explanation}</p>
            ) : result.unavailable ? (
              <AiNotice note={aiFallback(new Error(result.unavailable), AI_PLACEHOLDER.changesSummary)} onRetry={() => void run()} busy={busy} />
            ) : (
              <p style={{ ...bodyStyle, margin: "8px 0", color: colors.subtleInk }}>
                Nothing was recorded in the earlier period, so there is nothing to compare with yet.
              </p>
            )}
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Total</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Before</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Now</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Change</th>
                </tr>
              </thead>
              <tbody>
                <DeltaRow label="Stock out" d={facts.totals.totalOut} />
                <DeltaRow label="Production in" d={facts.totals.productionIn} />
                <DeltaRow label="Backloads" d={facts.totals.backloads} />
                <DeltaRow label="Returns to supplier" d={facts.totals.rts} />
                <DeltaRow label="Audit variance (size)" d={facts.totals.absVariance} bad />
                <DeltaRow label="Products with variance" d={facts.totals.flaggedProducts} bad />
              </tbody>
            </table>
            <Movers title="Stock out rose most" rows={facts.outflowUp} />
            <Movers title="Stock out fell most" rows={facts.outflowDown} />
            <Movers title="Variance grew most" rows={facts.varianceUp} bad />
          </>
        )}
      </AiOut>
    </div>
  );
}

function DeltaRow({ label, d, bad }: { label: string; d: ChangeDelta; bad?: boolean }) {
  // For variance, an increase is the unwelcome direction.
  const tone = d.change === 0 ? colors.subtleInk : bad && d.change > 0 ? colors.warningText : colors.ink;
  return (
    <tr>
      <td style={tdStyle}>{label}</td>
      <td style={{ ...tdStyle, textAlign: "right" }}>{fmt(d.previous)}</td>
      <td style={{ ...tdStyle, textAlign: "right" }}>{fmt(d.current)}</td>
      <td style={{ ...tdStyle, textAlign: "right", color: tone, whiteSpace: "nowrap" }}>
        {d.change === 0 ? "–" : `${signed(d.change)} ${pct(d)}`.trim()}
      </td>
    </tr>
  );
}

function Movers({ title, rows, bad }: { title: string; rows: ChangeMover[]; bad?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ ...mutedStyle, fontWeight: 600 }}>{title}</div>
      <ul style={{ listStyle: "none", margin: "2px 0 0", padding: 0 }}>
        {rows.map((m) => (
          <li key={`${m.sku ?? m.name}`} style={{ ...bodyStyle, margin: 0, display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span>{m.name}</span>
            <span style={{ whiteSpace: "nowrap", color: bad ? colors.warningText : colors.ink }}>
              {fmt(m.previous)} → {fmt(m.current)} {m.unit} ({signed(m.change)})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AskPanel({ onBusy, outEl, onFilled, onFresh }: { onBusy: (busy: boolean) => void } & OutProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [asked, setAsked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => onBusy(busy), [busy, onBusy]);

  /// Back to the starting point (the example chips) for the next question.
  function clear() {
    setAnswer(null);
    setError(null);
    setQuestion("");
    inputRef.current?.focus();
  }

  async function ask(q: string) {
    const text = q.trim();
    if (text.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    setAsked(text);
    try {
      setAnswer(await askData(text));
    } catch (e) {
      setAnswer(null);
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div aria-label="Ask the data">
      <form
        className="ae-dash-ai-row"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <h4 style={panelHeadingStyle}>Ask the data</h4>
        <input
          ref={inputRef}
          className="ae-input"
          aria-label="Your question"
          value={question}
          maxLength={300}
          disabled={busy}
          placeholder="e.g. Which products were short most often this month?"
          onChange={(e) => setQuestion(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Button type="submit" size="sm" disabled={busy || question.trim().length < 3}>
          {busy ? "Thinking…" : "Ask"}
        </Button>
      </form>

      <div className="ae-dash-ai-chips">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="ae-dash-ai-chip"
              onClick={() => {
                setQuestion(ex);
                void ask(ex);
              }}
            >
              {ex}
            </button>
          ))}
      </div>

      <AiOut panel="ask" outEl={outEl} onFilled={onFilled} onFresh={onFresh} signal={answer ?? error} filled={error !== null || !!answer}>
      {error !== null && <AiNotice note={aiFallback(error, AI_PLACEHOLDER.ask)} onRetry={() => void ask(asked)} busy={busy} />}

      {answer && (
        <div style={{ marginTop: 10 }} role="status" aria-live="polite">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <div style={{ ...mutedStyle, fontWeight: 600 }}>{asked}</div>
            <button type="button" className="ae-dash-ai-clear" onClick={clear}>
              Ask another
            </button>
          </div>
          <p style={{ ...bodyStyle, margin: "4px 0 8px", whiteSpace: "pre-wrap" }}>{answer.answer}</p>
          {answer.sources.length === 0 ? (
            <p style={mutedStyle}>No figures were looked up for this answer.</p>
          ) : (
            answer.sources.map((s, i) => (
              <details key={i} style={{ marginTop: 4 }}>
                <summary style={{ ...mutedStyle, cursor: "pointer" }}>
                  Based on: {TOOL_LABEL[s.tool] ?? s.tool}
                  {Object.keys(s.args).length > 0 && ` (${describeArgs(s.args)})`}
                </summary>
                <pre style={preStyle}>{JSON.stringify(s.result, null, 1)}</pre>
              </details>
            ))
          )}
        </div>
      )}
      </AiOut>
    </div>
  );
}

/// A helper's answer, shown in the card's shared answer area (a portal into it), not under its own
/// field. The area has a fixed height and scrolls inside itself, so a long answer never makes the card
/// (and everything under it) grow or jump; each new answer or error scrolls to its own top.
function AiOut({
  panel,
  outEl,
  onFilled,
  onFresh,
  signal,
  filled,
  children,
}: OutProps & { panel: "changed" | "ask"; signal: unknown; filled: boolean; children: ReactNode }) {
  const block = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onFilled(filled);
    return () => onFilled(false);
  }, [filled, onFilled]);
  useEffect(() => {
    if (signal) onFresh();
    const el = block.current;
    if (outEl && el && signal && typeof outEl.scrollTo === "function") outEl.scrollTo({ top: el.offsetTop, behavior: "smooth" });
  }, [signal, outEl, onFresh]);
  if (!outEl || !filled) return null;
  return createPortal(
    <div ref={block} className="ae-dash-ai-block" data-panel={panel}>
      {children}
    </div>,
    outEl,
  );
}

const panelHeadingStyle: CSSProperties = { margin: 0, fontSize: "calc(13px * var(--ae-fs, 1))", fontWeight: 700, color: colors.ink, whiteSpace: "nowrap" };
const bodyStyle: CSSProperties = { margin: "8px 0 0", fontSize: "calc(13px * var(--ae-fs, 1))", lineHeight: 1.5, color: colors.ink };
const mutedStyle: CSSProperties = { fontSize: "calc(11.5px * var(--ae-fs, 1))", color: colors.subtleInk };
const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "calc(12.5px * var(--ae-fs, 1))" };
const thStyle: CSSProperties = { textAlign: "left", padding: "3px 6px", fontWeight: 600, color: colors.subtleInk, borderBottom: `1px solid ${colors.border}` };
const tdStyle: CSSProperties = { padding: "3px 6px", borderBottom: `1px solid ${colors.border}`, color: colors.ink };
const preStyle: CSSProperties = {
  margin: "4px 0 0",
  padding: 8,
  maxHeight: 220,
  overflow: "auto",
  borderRadius: 4,
  border: `1px solid ${colors.border}`,
  background: colors.paperAlt,
  color: colors.ink,
  fontSize: "calc(11px * var(--ae-fs, 1))",
};
