/// The sections of the Settings page, in tab order. Kept apart from pages/SettingsPage.tsx so
/// the phone's search (utils/phoneSearch.ts) can list them without loading the page itself.
export type SettingsTab = "appearance" | "account" | "entry" | "backup" | "drive" | "reset" | "passwords";

export interface SettingsTabDef {
  key: SettingsTab;
  label: string;
  adminOnly: boolean;
  /// Other words someone might type to find this section (phone search only).
  keywords: string;
}

export const SETTINGS_TABS: SettingsTabDef[] = [
  { key: "appearance", label: "Appearance", adminOnly: false, keywords: "theme dark light mode font size text header layout style look colour color" },
  { key: "account", label: "My Account", adminOnly: false, keywords: "password change two-step verification authenticator mfa 2fa recovery codes sign in profile" },
  { key: "entry", label: "Entry Rules", adminOnly: true, keywords: "shifts night morning lock rules encoding" },
  { key: "backup", label: "Backup & Restore", adminOnly: true, keywords: "database download restore snapshot export history" },
  { key: "drive", label: "Google Drive", adminOnly: true, keywords: "gdrive connect cloud weekly backup upload" },
  { key: "reset", label: "Data Reset", adminOnly: true, keywords: "delete wipe clear erase all data passcode" },
  { key: "passwords", label: "User Passwords", adminOnly: true, keywords: "users accounts reset code set password encoder admin forgot" },
];

export function settingsTabsFor(isAdmin: boolean): SettingsTabDef[] {
  return SETTINGS_TABS.filter((t) => isAdmin || !t.adminOnly);
}

export function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.some((t) => t.key === value);
}
