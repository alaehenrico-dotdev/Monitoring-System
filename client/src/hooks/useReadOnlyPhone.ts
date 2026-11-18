import { useLayoutEffect, useSyncExternalStore } from "react";

/// A phone is a small touch screen showing the mobile layout. It is judged by
/// the page's layout width, not the screen's size, on purpose: a phone browser's
/// "Desktop site" option gives the page a desktop-sized layout width, so that
/// option is also the way out of the read-only view.
///
/// Foldables: a Galaxy Z Fold's inner screen is wider than 700px, so a half-folded
/// (tabletop/book) posture would read as a desktop site. A browser reports that posture
/// as two viewport segments (or `device-posture: folded`), which is a phone being held
/// folded, never a "Desktop site" request, so those count as phone too. A browser that
/// doesn't know a feature just skips that clause of the list.
///
/// Tablets (iPad, Android tablets, a foldable's flat inner screen) get the same read-only view: a
/// touch screen that is PHYSICALLY at least 600px wide (min-device-width: the screen, which a
/// "Desktop site" setting does not change) and whose layout is up to 1400px. The screen test is what
/// keeps a phone's "Desktop site" (a 980px layout on a 360px screen) a way out of the read-only view.
export const PHONE_QUERY = [
  "(max-width: 700px) and (pointer: coarse)",
  "(max-width: 1400px) and (min-device-width: 600px) and (pointer: coarse)",
  "(horizontal-viewport-segments: 2) and (pointer: coarse)",
  "(vertical-viewport-segments: 2) and (pointer: coarse)",
  "(device-posture: folded) and (pointer: coarse)",
].join(", ");

/// For testing on a computer (a narrow window is not a touch screen): open any
/// page with `?phone=1` to force the phone view on this browser, `?phone=0` to
/// go back to the automatic check.
const FORCE_KEY = "ala-eh-force-phone";

// The URL is parsed (and the choice saved) once per address, not on every render of every consumer.
let seenSearch: string | null = null;

function readForced(): boolean {
  try {
    if (window.location.search !== seenSearch) {
      seenSearch = window.location.search;
      const param = new URLSearchParams(seenSearch).get("phone");
      if (param === "1") localStorage.setItem(FORCE_KEY, "1");
      else if (param === "0") localStorage.removeItem(FORCE_KEY);
    }
    return localStorage.getItem(FORCE_KEY) === "1";
  } catch {
    return false;
  }
}

/// Whether this is a phone-sized touch screen (or the test override is on).
export function isPhoneView(): boolean {
  if (typeof window === "undefined") return false;
  if (readForced()) return true;
  return typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/// True on a phone: the app then shows only its read-only pages (see
/// config/navigation.ts, PHONE_PAGES).
export function useReadOnlyPhone(): boolean {
  return useSyncExternalStore(subscribe, isPhoneView, () => false);
}

/// Puts data-phone="true" on <html> while in phone view, which styles/phone.css keys on, and returns
/// whether it is a phone. Mounted once, by the app's Layout. A layout effect, so the phone styles are
/// there before the first paint rather than a frame later.
export function usePhoneAttribute(): boolean {
  const phone = useReadOnlyPhone();
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (phone) root.dataset.phone = "true";
    else delete root.dataset.phone;
    return () => {
      delete root.dataset.phone;
    };
  }, [phone]);
  return phone;
}
