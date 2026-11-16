import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  askData,
  getWhatChanged,
  type AskAnswer,
  type ChangeDelta,
  type ChangeMover,
  type WhatChanged,
} from "../api/ai";
import { Button } from "./ui";
import { colors } from "../theme";
import { formatDateDisplay } from "../utils/dateFormat";
import { describeArgs, TOOL_LABEL } from "../utils/aiSources";
import { AI_PLACEHOLDER, aiFallback } from "../utils/aiFallback";
import { AiNotice } from "./AiNotice";
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

  if (!enabled) return null;
  return (
    <section className="ae-dash-section" aria-label="AI insights" style={{ marginTop: 16 }}>
      <h3 className="ae-dash-heading">AI insights</h3>
      <div className="ae-dash-card" style={{ padding: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "18px 28px" }}>
          <WhatChangedPanel />
          <AskPanel />
        </div>
        <p style={{ ...mutedStyle, margin: "12px 0 0" }}>
          AI-written from your own figures - check the numbers before acting on them.
        </p>
      </div>
    </section>
  );
}

function WhatChangedPanel() {
  const [days, setDays] = useState(7);
  const [result, setResult] = useState<WhatChanged | null>(null);
  const [busy, setBusy] = useState(false);
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
      <h4 style={panelHeadingStyle}>What changed?</h4>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select
          className="ae-input"
          aria-label="Comparison window"
          value={days}
          disabled={busy}
          onChange={(e) => {
            latest.current++;
            setDays(Number(e.target.value));
            setResult(null);
            setError(null);
            setBusy(false);
          }}
          style={{ flex: 1, minWidth: 180 }}
        >
          {WINDOWS.map((w) => (
            <option key={w.days} value={w.days}>
              {w.label}
            </option>
          ))}
        </select>
        <Button type="button" size="sm" onClick={() => void run()} disabled={busy}>
          {busy ? "Comparing…" : result ? "Refresh" : "Compare"}
        </Button>
      </div>

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

function AskPanel() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [asked, setAsked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

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
      <h4 style={panelHeadingStyle}>Ask the data</h4>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input
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

      {!answer && !busy && !error && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              style={chipStyle}
              onClick={() => {
                setQuestion(ex);
                void ask(ex);
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {error !== null && <AiNotice note={aiFallback(error, AI_PLACEHOLDER.ask)} onRetry={() => void ask(asked)} busy={busy} />}

      {answer && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...mutedStyle, fontWeight: 600 }}>{asked}</div>
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
    </div>
  );
}

const panelHeadingStyle: CSSProperties = { margin: "0 0 8px", fontSize: "calc(13px * var(--ae-fs, 1))", fontWeight: 700, color: colors.ink };
const bodyStyle: CSSProperties = { margin: "8px 0 0", fontSize: "calc(13px * var(--ae-fs, 1))", lineHeight: 1.5, color: colors.ink };
const mutedStyle: CSSProperties = { fontSize: "calc(11.5px * var(--ae-fs, 1))", color: colors.subtleInk };
const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "calc(12.5px * var(--ae-fs, 1))" };
const thStyle: CSSProperties = { textAlign: "left", padding: "3px 6px", fontWeight: 600, color: colors.subtleInk, borderBottom: `1px solid ${colors.border}` };
const tdStyle: CSSProperties = { padding: "3px 6px", borderBottom: `1px solid ${colors.border}`, color: colors.ink };
const chipStyle: CSSProperties = {
  padding: "3px 10px",
  borderRadius: 999,
  border: `1px solid ${colors.border}`,
  background: colors.paperAlt,
  color: colors.ink,
  fontSize: "calc(11.5px * var(--ae-fs, 1))",
  cursor: "pointer",
};
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
