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
          ? "Days must now be finished in order before a later day can be entered."
          : "People can now fill in the present day while earlier days are still open.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the entry rule.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ae-panel" style={{ maxWidth: 640, padding: "14px 18px" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: colors.ink }}>Entry rules</div>
      <div style={{ fontSize: 12.5, color: colors.subtleInk, marginTop: 2 }}>
        How the Online and Offline entry pages behave for everyone.
      </div>

      {!rules ? (
        <div style={{ marginTop: 12 }}>
          <InlineLoading label="Loading…" />
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: colors.ink }}>
            <input
              type="checkbox"
              style={{ marginTop: 3 }}
              checked={rules.requireEarlierDaysFinished}
              disabled={saving}
              onChange={(e) => void setRequireOrder(e.target.checked)}
            />
            <span>
              <strong>Finish days in order</strong>
              <span style={{ display: "block", fontSize: 12.5, color: colors.subtleInk, marginTop: 2 }}>
                On: an entry page stays read-only while an earlier day with saved entries is still unfinished, and
                shows "Finish that day first".
                <br />
                Off: people can fill in the present day even if earlier days have not been finished yet.
              </span>
            </span>
          </label>

          {!rules.requireEarlierDaysFinished && (
            <div role="status" style={{ marginTop: 10, fontSize: 12.5, color: colors.ink }}>
              While earlier days are open, their figures can still change, and the opening stock that carries forward
              into later days follows them. <strong>Finishing a day still goes in order</strong> - a later day cannot
              be finished until the earlier ones are - so locked days never move.
            </div>
          )}
        </div>
      )}

      <Toast message={notice} onDismiss={() => setNotice(null)} variant="success" />
      <Toast message={error} onDismiss={() => setError(null)} variant="error" duration={null} />
    </div>
  );
}
