/// Registers the offline service worker (production builds only - in dev it
/// would cache stale modules out from under Vite's HMR). Best effort: a
/// browser without service workers just runs online-only, as before.
export function registerServiceWorker() {
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
