/// The Tauri desktop client's own origin - tauri://localhost on most
/// platforms, https://tauri.localhost on Windows/WebView2 (confirmed from an
/// actual DevTools error, not Tauri's own docs - see TAURI_SETUP.md). Shared
/// by app.ts's CORS allowlist and auth.controller.ts's desktop-login
/// detection, so the two never drift apart on what counts as "the desktop
/// app" - a mismatch here means either CORS silently blocks the desktop
/// client's real requests again (exactly what happened before - see git
/// history) or a desktop login gets the short web-session expiry by mistake.
export const TAURI_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];
