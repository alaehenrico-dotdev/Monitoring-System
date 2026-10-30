import { useState } from "react";
import { DatabaseBackupPage } from "./DatabaseBackupPage";
import { DataResetPage } from "./DataResetPage";
import { UserPasswordsPage } from "./UserPasswordsPage";
import { AccountSettings } from "./AccountSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { GoogleDriveSettings } from "./GoogleDriveSettings";
import { EntryRulesSettings } from "./EntryRulesSettings";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../context/AuthContext";

type Tab = "appearance" | "account" | "entry" | "backup" | "drive" | "reset" | "passwords";

const TABS: { key: Tab; label: string; adminOnly: boolean }[] = [
  { key: "appearance", label: "Appearance", adminOnly: false },
  { key: "account", label: "My Account", adminOnly: false },
  { key: "entry", label: "Entry Rules", adminOnly: true },
  { key: "backup", label: "Backup & Restore", adminOnly: true },
  { key: "drive", label: "Google Drive", adminOnly: true },
  { key: "reset", label: "Data Reset", adminOnly: true },
  { key: "passwords", label: "User Passwords", adminOnly: true },
];

/// Section Admin - groups the two "system-level" admin tools (Database
/// Backup, Data Reset) behind one Settings page with tabs, rather than two
/// separate sidebar entries. Data Reset keeps its own passcode gate
/// (DataResetPage) even though it now lives one click deeper - the tab
/// switch alone is not treated as authorization for that action.
///
/// Appearance is the one tab every role gets - it only changes how the app looks
/// in this browser. The admin tools are hidden from everyone else here, and the
/// server refuses them regardless of what the page shows.
export function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "SUPERVISOR_ADMIN";
  const tabs = TABS.filter((t) => isAdmin || !t.adminOnly);
  // Google sends the browser back here with ?drive=... after the consent screen,
  // so that is the tab to land on.
  const [tab, setTab] = useState<Tab>(() =>
    isAdmin && new URLSearchParams(window.location.search).has("drive") ? "drive" : "appearance",
  );

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle={isAdmin ? "How the app looks, plus admin tools: backups, data reset, and passwords." : "How the app looks on this computer."}
      />

      <div className="ae-subtabs" role="tablist" aria-label="Settings sections">
        {tabs.map((t) => (
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

      {tab === "appearance" && <AppearanceSettings />}
      {tab === "account" && <AccountSettings />}
      {isAdmin && tab === "entry" && <EntryRulesSettings />}
      {isAdmin && tab === "backup" && <DatabaseBackupPage />}
      {isAdmin && tab === "drive" && <GoogleDriveSettings />}
      {isAdmin && tab === "reset" && <DataResetPage />}
      {isAdmin && tab === "passwords" && <UserPasswordsPage />}
    </div>
  );
}
