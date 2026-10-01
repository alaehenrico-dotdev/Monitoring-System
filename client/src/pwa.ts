/// Registers the offline service worker (production builds only - in dev it
/// would cache stale modules out from under Vite's HMR). Best effort: a
/// browser without service workers just runs online-only, as before.
///
/// Skipped entirely in the Tauri desktop build (`vite build --mode tauri`):
/// the app isn't served over http(s) there, there's no "offline web page" to
/// cache, and Tauri's own webview doesn't expose a stable serviceWorker/cache
/// story the same way a browser tab does.
export function registerServiceWorker() {
  if (import.meta.env.MODE === "tauri") return;
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is an enhancement; never surface a failure.
    });
  });
}

/// Drops cached API responses - called on logout so the next person to use a
/// shared device can't read the previous user's offline data.
export function clearOfflineApiCache() {
  try {
    void caches?.delete("ala-eh-api-v1");
  } catch {
    // no Cache API (e.g. insecure context)
  }
}
