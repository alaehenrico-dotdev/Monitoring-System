import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAlerts } from "../hooks/useAlerts";
import { currentMode, disableNotifications, enableNotifications, type NotifyMode } from "../utils/pushNotifications";
import { BellIcon } from "./icons";

const SHOWN = 6;

const MODE_TEXT: Record<NotifyMode, string> = {
  unsupported: "This browser cannot show notifications.",
  blocked: "Notifications are blocked. Allow them in your browser's site settings.",
  off: "Notifications are off on this device.",
  local: "Notifications on while the app is open.",
  push: "Notifications on, even when the app is closed.",
};

/// Header bell for the Supervisor/Admin: the number of things that need attention, a short list,
/// and the switch that turns notifications on for this device.
export function AlertBell() {
  const state = useAlerts();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<NotifyMode>(() => currentMode());
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!state) return null;
  const { alerts } = state;
  const total = alerts?.total ?? 0;
  const urgent = alerts?.urgent ?? 0;
  const items = alerts?.items ?? [];
  const sorted = [...items].sort((a, b) => Number(b.severity === "high") - Number(a.severity === "high"));

  const toggle = async () => {
    setBusy(true);
    setMode(mode === "local" || mode === "push" ? await disableNotifications() : await enableNotifications());
    setBusy(false);
  };

  return (
    <span className="ae-alert-bell no-print" ref={box}>
      <button
        type="button"
        className="ae-header-search-btn ae-alert-bell-btn"
        aria-label={total ? `${total} thing${total === 1 ? "" : "s"} need attention` : "Nothing needs attention"}
        aria-expanded={open}
        title="Alerts"
        onClick={() => setOpen((o) => !o)}
      >
        <BellIcon />
        {total > 0 && <span className={`ae-alert-badge${urgent > 0 ? " ae-alert-badge--urgent" : ""}`}>{total > 99 ? "99+" : total}</span>}
      </button>
      {open && (
        <div className="ae-alert-pop" role="dialog" aria-label="Alerts">
          {total === 0 ? (
            <p className="ae-alert-empty">Nothing needs attention.</p>
          ) : (
            <ul className="ae-alert-list">
              {sorted.slice(0, SHOWN).map((i) => (
                <li key={i.id}>
                  <Link to={i.link} onClick={() => setOpen(false)} className={i.severity === "high" ? "ae-alert-item ae-alert-item--urgent" : "ae-alert-item"}>
                    {i.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link to="/admin-queue" className="ae-alert-all" onClick={() => setOpen(false)}>
            {total > SHOWN ? `See all ${total} in the Admin Queue` : "Open the Admin Queue"}
          </Link>
          <div className="ae-alert-notify">
            <span>{MODE_TEXT[mode]}</span>
            {mode !== "unsupported" && mode !== "blocked" && (
              <button type="button" className="ae-alert-toggle" onClick={() => void toggle()} disabled={busy}>
                {mode === "off" ? "Turn on" : "Turn off"}
              </button>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
