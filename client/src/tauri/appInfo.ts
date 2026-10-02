// Only ever called from main.tsx behind an `import.meta.env.MODE === "tauri"`
// check, same reasoning as updater.ts - keeps `@tauri-apps/api/window` out of
// the plain web build's bundle.
//
// Sets the OS window title bar to include the running version
// (__APP_VERSION__ - injected at build time from package.json, see
// vite.config.ts) beside the app name, e.g. "Ala Eh Stocks Monitoring System
// v1.4.0" - tauri.conf.json's own static `title` has no version in it and
// isn't worth hand-editing on every release, so this overrides it once at
// startup instead.
export async function setWindowTitleWithVersion(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(`Ala Eh Stocks Monitoring System v${__APP_VERSION__}`);
  } catch (err) {
    // Best effort - a stock window title is a cosmetic downgrade, never
    // worth blocking the app over.
    console.error("Failed to set window title", err);
  }
}
