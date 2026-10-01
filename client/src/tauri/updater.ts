// Only ever called from main.tsx behind an `import.meta.env.MODE === "tauri"`
// check, and only imports the Tauri updater/process plugins dynamically so
// this module (and its deps) never end up in the plain web build's bundle -
// those plugins' JS talks to Tauri's IPC bridge, which doesn't exist there.
export async function checkForUpdates(): Promise<void> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return;

    const install = window.confirm(
      `A new version (${update.version}) is available. Install it now? The app will restart.`,
    );
    if (!install) return;

    await update.downloadAndInstall();

    // downloadAndInstall() only replaces the files on disk - the running
    // process keeps going until relaunch() actually exits it. The download
    // itself can take a while on a slow connection, and the grid stays fully
    // interactive the whole time, so someone could easily stage new entry
    // edits (sessionStorage - see utils/unsavedWork.ts) in that window. Those
    // wouldn't survive the process restart a relaunch does, so re-check right
    // before pulling that trigger rather than trusting the state from when
    // "Install" was first clicked.
    const { hasAnyUnsavedWork } = await import("../utils/unsavedWork");
    if (hasAnyUnsavedWork()) {
      window.alert(
        "Update downloaded, but you have unsaved changes on an entry page. Save your work, then close and reopen the app to finish installing it.",
      );
      return;
    }

    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    // Best effort - a failed update check should never block the app from
    // starting (e.g. the configured server is unreachable, or this release
    // has no update endpoint configured yet).
    console.error("Update check failed", err);
  }
}
