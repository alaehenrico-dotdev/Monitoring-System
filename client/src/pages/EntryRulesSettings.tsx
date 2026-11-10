import { useEffect, useState } from "react";
import { getEntryRules, updateEntryRules, type EntryRules } from "../api/appSettings";
import { InlineLoading } from "../components/Spinner";
import { Toast } from "../components/Toast";
import { colors } from "../theme";

/// Settings > Entry Rules - switches that change how the Online and Offline entry
/// pages behave for everyone. Each applies the moment it is changed, and open
/// entry pages pick it up without a refresh.
export function EntryRulesSettings() {
  const [rules, setRules] = useState<EntryRules | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEntryRules()
      .then((r) => !cancelled && setRules(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load the entry rules."));
    return () => {
      cancelled = true;
    };
  }, []);

  async function setRequireOrder(requireEarlierDaysFinished: boolean) {
    setSaving(true);
    setError(null);
    try {
      setRules(await updateEntryRules({ requireEarlierDaysFinished }));
      setNotice(
        requireEarlierDaysFinished
          ? "Days must be finished in order."
          : "Today can be entered while earlier days are open.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the entry rule.");
    } finally {
      setSaving(false);
    }
  }

  async function setUseShifts(useShifts: boolean) {
    const message = useShifts
      ? "Switch Morning and Night shifts back on?\n\nThe shift picker returns and the 4pm cutoff applies."
      : "Switch off shifts?\n\nEach day becomes one whole sheet by calendar date. Earlier shift days stay as they are, read-only. Everyone's page reloads.";
    if (!window.confirm(message)) return;
    setSaving(true);
    setError(null);
    try {
      await updateEntryRules({ useShifts });
      // The whole app changes shape with this, so start every page afresh.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the entry rule.");
      setSaving(false);
    }
  }

  return (
    <div className="ae-panel ae-rules" style={{ maxWidth: 640, padding: "14px 18px" }}>
      <div style={{ fontSize: "calc(14px * var(--ae-fs, 1))", fontWeight: 600, color: colors.ink }}>Entry rules</div>
      <div style={{ fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.subtleInk, marginTop: 2 }}>
        How the entry pages behave for everyone.
      </div>

      {!rules ? (
        <div style={{ marginTop: 12 }}>
          <InlineLoading label="Loading…" />
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: "calc(13px * var(--ae-fs, 1))", color: colors.ink }}>
            <input
              type="checkbox"
              style={{ marginTop: 3 }}
              checked={rules.requireEarlierDaysFinished}
              disabled={saving}
              onChange={(e) => void setRequireOrder(e.target.checked)}
            />
            <span>
              <strong>Finish days in order</strong>
              <span className="ae-rule-desc" style={{ display: "block", fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.subtleInk, marginTop: 2 }}>
                <span style={{ display: "block" }}>On: earlier days must be finished first.</span>
                <span style={{ display: "block" }}>Off: today can be entered while earlier days are open.</span>
              </span>
            </span>
          </label>

          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: "calc(13px * var(--ae-fs, 1))", color: colors.ink, marginTop: 16 }}>
            <input
              type="checkbox"
              style={{ marginTop: 3 }}
              checked={rules.useShifts}
              disabled={saving}
              onChange={(e) => void setUseShifts(e.target.checked)}
            />
            <span>
              <strong>Use Morning and Night shifts</strong>
              <span className="ae-rule-desc" style={{ display: "block", fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.subtleInk, marginTop: 2 }}>
                <span style={{ display: "block" }}>On: Morning (7am–4pm) and Night (4pm–1am) sheets.</span>
                <span style={{ display: "block" }}>Off: one whole sheet per day, by calendar date.</span>
              </span>
            </span>
          </label>

          {!rules.requireEarlierDaysFinished && (
            <div role="status" className="ae-rule-desc" style={{ marginTop: 10, fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.ink }}>
              Open earlier days can still change the opening stock of later days. <strong>Finishing days still goes in order.</strong>
            </div>
          )}
        </div>
      )}

      <Toast message={notice} onDismiss={() => setNotice(null)} variant="success" />
      <Toast message={error} onDismiss={() => setError(null)} variant="error" duration={null} />
    </div>
  );
}
