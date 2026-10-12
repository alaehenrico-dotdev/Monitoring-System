import { useState } from "react";
import { DatabaseBackupPage } from "./DatabaseBackupPage";
import { DataResetPage } from "./DataResetPage";
import { UserPasswordsPage } from "./UserPasswordsPage";
import { PageHeader } from "../components/PageHeader";

type Tab = "backup" | "reset" | "passwords";

const TABS: { key: Tab; label: string }[] = [
  { key: "backup", label: "Backup & Restore" },
  { key: "reset", label: "Data Reset" },
  { key: "passwords", label: "User Passwords" },
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
      <PageHeader
        title="Settings"
        subtitle="Admin tools: backups, data reset, and passwords."
      />

      <div className="ae-subtabs" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === tab}
            className="ae-subtab"
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "backup" && <DatabaseBackupPage />}
      {tab === "reset" && <DataResetPage />}
      {tab === "passwords" && <UserPasswordsPage />}
    </div>
  );
}
