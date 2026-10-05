import { useState, type FormEvent } from "react";
import { API_URL, getDefaultApiUrl, getStoredApiUrl, resetApiUrl, setApiUrl } from "../api/http";
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

  if (!isTauri) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 12,
          color: colors.cream,
          opacity: 0.65,
          marginTop: 14,
          textDecoration: "underline",
        }}
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
  const hasOverride = getStoredApiUrl() !== null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Enter a server address.");
      return;
    }
    try {
      // Must resolve to an absolute http(s) URL - a relative path (the web
      // build's own default) means nothing once this becomes the base of
      // every request in a desktop window with no origin of its own.
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("not http(s)");
      }
    } catch {
      setError("That doesn't look like a valid address, e.g. http://192.168.0.178:4000/api");
      return;
    }
    setApiUrl(trimmed);
  }

  function handleReset() {
    resetApiUrl();
  }

  return (
    <Modal title="Server address" onClose={onClose} width={420}>
      <form onSubmit={handleSubmit}>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: colors.subtleInk, lineHeight: 1.5 }}>
          Point this device at a different server, e.g. after the server machine's
          network address changes. Saving reloads the app and signs you out.
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
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save &amp; reload</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
