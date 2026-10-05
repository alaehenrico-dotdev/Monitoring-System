import { useState, type FormEvent } from "react";
import { API_URL, getDefaultApiUrl, getStoredApiUrl, resetApiUrl, setApiUrl } from "../api/http";
import { useServerReachable } from "../api/reachability";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { Modal } from "./Modal";
import { Button, Field, TextInput } from "./ui";
import { colors } from "../theme";

const isTauri = import.meta.env.MODE === "tauri";

/// Only the Tauri desktop build points at an absolute, user-visible server
/// address (see http.ts's comment) - the web build's relative "/api" is
/// fixed by its own deployment and isn't meant to be end-user-editable, so
/// this renders nothing there.
export function ServerSettingsLink() {
  const [open, setOpen] = useState(false);
  // Keep reachability current even on the login screen, where the app shell's
  // normal connectivity hook is not mounted.
  useOnlineStatus();
  const serverReachable = useServerReachable();

  if (!isTauri || serverReachable) return null;

  return (
    <>
      <button
        type="button"
        className="ae-server-settings-link"
        onClick={() => setOpen(true)}
      >
        Can't connect? Change server address
      </button>
      {open && <ServerSettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ServerSettingsModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState(API_URL);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const hasOverride = getStoredApiUrl() !== null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Enter a server address.");
      return;
    }
    let parsed: URL;
    try {
      // Must resolve to an absolute http(s) URL - a relative path (the web
      // build's own default) means nothing once this becomes the base of
      // every request in a desktop window with no origin of its own.
      parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("not http(s)");
      }
    } catch {
      setError("That doesn't look like a valid address, e.g. http://192.168.0.178:4000/api");
      return;
    }

    setTesting(true);
    try {
      const healthUrl = new URL("/health", parsed).toString();
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      let response: Response;
      try {
        response = await fetch(healthUrl, { signal: controller.signal });
      } finally {
        window.clearTimeout(timeout);
      }
      if (!response.ok) throw new Error("The server did not pass its health check.");
      setApiUrl(trimmed);
    } catch {
      setError("Couldn't reach that server. Check the URL and connection, then try again.");
    } finally {
      setTesting(false);
    }
  }

  function handleReset() {
    resetApiUrl();
  }

  return (
    <Modal title="Server address" onClose={onClose} width={420}>
      <form onSubmit={handleSubmit}>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: colors.subtleInk, lineHeight: 1.5 }}>
          Use a stable HTTPS server address to connect from different routers. A
          local network address only works while this device can reach that network.
          The address is checked before switching; switching signs you out.
        </p>
        <Field label="Server URL" style={{ marginBottom: 12 }}>
          <TextInput
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://192.168.0.178:4000/api"
            style={{ width: "100%" }}
            autoFocus
          />
        </Field>
        {error && (
          <p style={{ margin: "0 0 12px", fontSize: 12.5, color: colors.danger }}>{error}</p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={!hasOverride}
            title={hasOverride ? undefined : `Already using the default (${getDefaultApiUrl()})`}
          >
            Reset to default
          </Button>
          <div style={{ display: "flex", gap: 10 }}>
            <Button type="button" variant="secondary" onClick={onClose} disabled={testing}>
              Cancel
            </Button>
            <Button type="submit" disabled={testing}>
              {testing ? "Checking server…" : "Test & switch"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
