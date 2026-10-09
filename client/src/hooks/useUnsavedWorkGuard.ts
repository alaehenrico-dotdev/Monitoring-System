import { useEffect, useRef } from "react";
import { countAllUnsavedWork } from "../utils/unsavedWork";
import { releaseTab, syncDraftBackup } from "../utils/draftBackup";

const SYNC_INTERVAL_MS = 1000;

/// The slice of Tauri v2's window API this needs. Looked up on the global the
/// shell injects (`withGlobalTauri`) so the web build has no dependency on
/// @tauri-apps/api; when the global or `destroy` is missing the desktop close
/// guard is simply not installed and the localStorage backup is the safety net.
interface TauriWindowLike {
  onCloseRequested?: (
    handler: (event: { preventDefault: () => void }) => void | Promise<void>,
  ) => Promise<unknown>;
  destroy?: () => Promise<void>;
}

function getTauriWindow(): TauriWindowLike | null {
  const w = (
    window as unknown as { __TAURI__?: { window?: Record<string, unknown> } }
  ).__TAURI__?.window;
  if (!w) return null;
  const current =
    typeof w.getCurrentWindow === "function"
      ? (w.getCurrentWindow as () => unknown)()
      : typeof w.getCurrent === "function"
        ? (w.getCurrent as () => unknown)()
        : w.appWindow;
  return (current as TauriWindowLike | undefined) ?? null;
}

/**
 * One app-wide guard for staged-but-unsaved edits, mounted once in Layout:
 *
 *  - Closing/reloading the tab warns whenever ANY page, date or shift still has
 *    staged edits - the per-page guards only knew about their own current
 *    sheet, so edits left on another date/shift or another page closed
 *    silently.
 *  - Mirrors the staged edits to localStorage (see utils/draftBackup.ts) every
 *    second and on page hide, so a closed window, crash or power cut doesn't
 *    lose them.
 *  - On the desktop app, where the window's close button doesn't raise a
 *    beforeunload prompt, asks `onCloseBlocked` to confirm first.
 *
 * `onCloseBlocked(proceed)` is only called when there is unsaved work; calling
 * `proceed()` closes the window.
 */
export function useUnsavedWorkGuard(
  userId: number | undefined,
  onCloseBlocked: (proceed: () => void) => void,
) {
  const onCloseBlockedRef = useRef(onCloseBlocked);
  useEffect(() => {
    onCloseBlockedRef.current = onCloseBlocked;
  });

  useEffect(() => {
    if (userId === undefined) return;
    const uid = userId;

    syncDraftBackup(uid);
    const timer = window.setInterval(
      () => syncDraftBackup(uid),
      SYNC_INTERVAL_MS,
    );

    function onBeforeUnload(e: BeforeUnloadEvent) {
      syncDraftBackup(uid);
      if (countAllUnsavedWork() === 0) return;
      e.preventDefault();
      // Older engines only show the prompt when returnValue is set.
      e.returnValue = "";
    }
    function onPageHide() {
      syncDraftBackup(uid);
      releaseTab();
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") syncDraftBackup(uid);
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);

    // Desktop shell: closing the window never reaches beforeunload.
    let unlistenClose: (() => void) | undefined;
    let disposed = false;
    const tauriWindow = getTauriWindow();
    if (tauriWindow?.onCloseRequested && tauriWindow.destroy) {
      void tauriWindow
        .onCloseRequested((event) => {
          syncDraftBackup(uid);
          if (countAllUnsavedWork() === 0) return;
          event.preventDefault();
          onCloseBlockedRef.current(() => {
            void tauriWindow.destroy?.();
          });
        })
        .then((unlisten) => {
          if (typeof unlisten !== "function") return;
          if (disposed) unlisten();
          else unlistenClose = unlisten as () => void;
        })
        .catch(() => {});
    }

    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      unlistenClose?.();
    };
  }, [userId]);
}
