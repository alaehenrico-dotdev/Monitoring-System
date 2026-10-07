/// Registers the static-asset service worker in production. API responses
/// are never cached; the app requires a live server for data access.
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is an enhancement; never surface a failure.
    });
  });
}
