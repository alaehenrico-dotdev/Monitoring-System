import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

export type DownloadKind = "PDF" | "Excel" | "CSV" | "Database backup";

interface DownloadRequest {
  kind: DownloadKind;
  filename?: string;
  resolve: (confirmed: boolean) => void;
}

// The confirmation only exists in the desktop (Tauri) build - the browser
// already shows its own download UI. Flip this to `true` to ask on the web
// build too.
const ASK_BEFORE_DOWNLOAD = import.meta.env.MODE === "tauri";

let openRequest: ((req: DownloadRequest) => void) | null = null;

/// Resolves true once the person confirms the download, false if they cancel.
/// Always resolves true straight away outside the desktop app (or if the
/// host below isn't mounted), so callers can use it unconditionally:
///
///   if (!(await confirmDownload("PDF", filename))) return;
export function confirmDownload(kind: DownloadKind, filename?: string): Promise<boolean> {
  if (!ASK_BEFORE_DOWNLOAD || !openRequest) return Promise.resolve(true);
  return new Promise((resolve) => openRequest!({ kind, filename, resolve }));
}

const COPY: Record<DownloadKind, { title: string; action: string }> = {
  PDF: { title: "Download PDF?", action: "a PDF" },
  Excel: { title: "Download Excel file?", action: "an Excel file" },
  CSV: { title: "Download CSV file?", action: "a CSV file" },
  "Database backup": { title: "Download database backup?", action: "a full database backup" },
};

/// Mounted once (Layout.tsx). Shows one confirmation at a time; any further
/// requests wait in line behind it.
export function DownloadConfirmHost() {
  const [queue, setQueue] = useState<DownloadRequest[]>([]);
  const queueRef = useRef<DownloadRequest[]>([]);
  // Synced in an effect rather than during render (refs must not be written
  // while rendering). Only ever read from the unmount cleanup below, which
  // runs after this has committed, so it still sees the latest queue.
  useEffect(() => {
    queueRef.current = queue;
  });

  useEffect(() => {
    openRequest = (req) => setQueue((q) => [...q, req]);
    return () => {
      openRequest = null;
      // Unmounting with a dialog still open counts as a cancel, so nothing
      // is left awaiting forever.
      queueRef.current.forEach((r) => r.resolve(false));
    };
  }, []);

  const current = queue[0];
  if (!current || !ASK_BEFORE_DOWNLOAD) return null;
  const request = current;
  const copy = COPY[request.kind];

  function answer(confirmed: boolean) {
    request.resolve(confirmed);
    setQueue((q) => q.slice(1));
  }

  return (
    <ConfirmDialog
      title={copy.title}
      confirmLabel="Download"
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    >
      <p style={{ margin: 0 }}>
        Save {copy.action} to this computer?
        {request.filename && (
          <>
            <br />
            <strong style={{ wordBreak: "break-all" }}>{request.filename}</strong>
          </>
        )}
      </p>
      {request.kind === "Database backup" && (
        <p style={{ margin: "10px 0 0", fontSize: 12.5, opacity: 0.8 }}>
          This is a full copy of the database and can be large.
        </p>
      )}
    </ConfirmDialog>
  );
}