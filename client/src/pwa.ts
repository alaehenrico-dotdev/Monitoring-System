import { notify } from "./utils/notify";

/// How often an open tab asks the server whether a newer build exists, and the
/// least time between two such asks (coming back to the tab asks too).
const CHECK_EVERY_MS = 30 * 60 * 1000;
const MIN_GAP_MS = 5 * 60 * 1000;

/// A new build took over while this page was open: the page still runs the old
/// code, and the API may have moved on with it, so say so and offer the refresh.
function announceNewVersion(): void {
  notify({
    level: "info",
    message: "A new version of the system is available.",
    persistent: true,
    action: { label: "Refresh", onClick: () => window.location.reload() },
  });
}

/// Watches for a newer service worker (= a new deploy) and announces it once.
/// `controllerchange` also fires on a first-ever visit, when the worker takes
/// control of a page that had none: that is not an update, so it is ignored.
export function watchForNewVersion(container: ServiceWorkerContainer, registration: Pick<ServiceWorkerRegistration, "update">): () => void {
  const hadController = Boolean(container.controller);
  let announced = false;
  let lastCheck = Date.now();

  const onChange = () => {
    if (!hadController || announced) return;
    announced = true;
    announceNewVersion();
  };
  container.addEventListener("controllerchange", onChange);

  const check = () => {
    lastCheck = Date.now();
    registration.update().catch(() => {
      // Offline or the server is down: the next check tries again.
    });
  };
  const onVisible = () => {
    if (document.visibilityState === "visible" && Date.now() - lastCheck >= MIN_GAP_MS) check();
  };
  document.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(check, CHECK_EVERY_MS);

  return () => {
    container.removeEventListener("controllerchange", onChange);
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(timer);
  };
}

/// Registers the static-asset service worker in production. API responses
/// are never cached; the app requires a live server for data access.
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => watchForNewVersion(navigator.serviceWorker, registration))
      .catch(() => {
        // Offline support is an enhancement; never surface a failure.
      });
  });
}
