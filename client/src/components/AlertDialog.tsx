import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Modal } from "./Modal";
import { Button } from "./ui";
import { formatDateDisplay } from "../utils/dateFormat";
import type { UnsavedWorkItem } from "../utils/unsavedWork";

/**
 * A "heads up" dialog with a single OK - for telling someone why an action
 * didn't go ahead, as opposed to ConfirmDialog, which asks them to choose.
 * Built on the shared Modal, so it gets the same backdrop, Escape and
 * click-outside-to-close behavior as every other dialog. OK is auto-focused,
 * so Enter dismisses it.
 */
export function AlertDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} width={440} bordered>
      <div role="alert" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
        {children}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
        <Button variant="primary" onClick={onClose} autoFocus>
          OK
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Shown instead of generating a report while there are staged-but-unsaved
 * edits (see utils/unsavedWork.ts) for the dates the report covers - a
 * report only reads saved data, so it would silently leave those edits out.
 * Each line links to the page where they can be saved.
 */
export function UnsavedWorkDialog({ items, onClose }: { items: UnsavedWorkItem[]; onClose: () => void }) {
  return (
    <AlertDialog title="Unsaved changes" onClose={onClose}>
      <p style={{ margin: 0 }}>Please save your changes before generating a report.</p>
      <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
        {items.map((item) => (
          <li key={`${item.page}:${item.date}:${item.shift}:${item.location ?? ""}`}>
            <Link to={item.route} style={{ color: "inherit", fontWeight: 600 }}>
              {item.page}
            </Link>
            {" - "}
            {formatDateDisplay(item.date)}, {item.shift}
            {item.location ? `, ${item.location}` : ""}
          </li>
        ))}
      </ul>
    </AlertDialog>
  );
}