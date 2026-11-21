import { useEffect, useState } from "react";
import { getMyHistory, type HistoryEntry } from "../api/countSubmissions";
import type { Shift } from "../types";
import { formatClock, formatDateLong } from "../utils/dateFormat";
import { isWholeDayMode, SHIFT_SHORT_LABELS } from "../utils/shift";
import { Modal } from "./Modal";
import "../styles/auditor-count.css";

/**
 * The auditor's own recent counts (last 30 days): which sheet, whether it was sent, how much they
 * counted, and whether it can still be edited. Only their own figures - nothing from the system or the
 * other auditor. Choosing one opens that sheet in the count page.
 */
export function AuditorHistoryModal({ currentDate, currentShift, onOpen, onClose }: { currentDate: string; currentShift: Shift; onOpen: (date: string, shift: Shift) => void; onClose: () => void }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMyHistory()
      .then((list) => !cancelled && setEntries(list))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const wholeDay = isWholeDayMode();
  return (
    <Modal title="My counts" width={440} onClose={onClose}>
      {failed ? (
        <p role="alert">Could not load your counts. Check your connection and try again.</p>
      ) : !entries ? (
        <p role="status">Loading…</p>
      ) : entries.length === 0 ? (
        <p>Nothing counted in the last 30 days.</p>
      ) : (
        <ul className="ae-ah-list">
          {entries.map((e) => {
            const here = e.date === currentDate && e.shift === currentShift;
            const state = e.status === "DRAFT" ? "Not submitted" : e.published ? "Published - locked" : "Submitted";
            return (
              <li key={`${e.date}|${e.shift}`}>
                <button type="button" className="ae-ah-item" aria-current={here || undefined} onClick={() => onOpen(e.date, e.shift)}>
                  <span className="ae-ah-title">
                    {formatDateLong(e.date)}
                    {wholeDay ? "" : ` - ${SHIFT_SHORT_LABELS[e.shift]}`}
                  </span>
                  <span className={`ae-rv-tag${e.status === "SUBMITTED" && !e.published ? " ae-rv-tag--sent" : ""}`}>{state}</span>
                  <span className="ae-ah-meta">
                    Online {e.counted.ONLINE} · Offline {e.counted.OFFLINE}
                    {e.submittedAt ? ` · sent ${formatClock(Date.parse(e.submittedAt))}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
