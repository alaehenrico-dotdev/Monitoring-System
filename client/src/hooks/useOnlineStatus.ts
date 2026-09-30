import { useEffect, useState } from "react";

/// Tracks the browser's connectivity. `reconnects` bumps every time the
/// connection comes back, so a page can list it in a data-fetching effect's
/// dependencies and re-pull fresh server data on resync (the trigger for
/// detecting conflicts with edits made while offline).
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [reconnects, setReconnects] = useState(0);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      setReconnects((n) => n + 1);
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return { online, reconnects };
}
