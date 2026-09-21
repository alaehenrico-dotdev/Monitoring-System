import { useState } from "react";
import { DatabaseBackupPage } from "./DatabaseBackupPage";
import { DataResetPage } from "./DataResetPage";
import { colors } from "../theme";

type Tab = "backup" | "reset";

const TABS: { key: Tab; label: string }[] = [
  { key: "backup", label: "Database Backup" },
  { key: "reset", label: "Data Reset" },
];

/// Section Admin - groups the two "system-level" admin tools (Database
/// Backup, Data Reset) behind one Settings page with tabs, rather than two
/// separate sidebar entries. Data Reset keeps its own passcode gate
/// (DataResetPage) even though it now lives one click deeper - the tab
/// switch alone is not treated as authorization for that action.
export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("backup");

  return (
    <div>
      <h2 style={{ margin: "-8px 0 0px" }}>Settings</h2>
      <p style={{ fontSize: 13, color: colors.subtleInk, margin: "0 0 20px", maxWidth: 760 }}>
        System-level tools for administrators - back up the database or wipe it for a fresh start.
      </p>

      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${colors.border}`, marginBottom: 24 }}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                fontFamily: "inherit",
                fontSize: 13.5,
                fontWeight: active ? 700 : 500,
                cursor: "pointer",
                background: "transparent",
                border: "none",
                borderBottom: active ? `2px solid ${colors.yellow}` : "2px solid transparent",
                color: active ? colors.ink : colors.subtleInk,
                padding: "10px 16px",
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "backup" ? <DatabaseBackupPage /> : <DataResetPage />}
    </div>
  );
}
