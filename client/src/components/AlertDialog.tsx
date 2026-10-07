import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Toast } from "./Toast";
import { formatDateDisplay } from "../utils/dateFormat";
import type { UnsavedWorkItem } from "../utils/unsavedWork";

/**
 * A "heads up" notice for telling someone why an action didn't go ahead, as
 * opposed to ConfirmDialog, which asks them to choose. Shown as a toast in
 * the bottom-right corner (not a centered dialog) - it's mounted while the
 * caller's message state is set and calls `onClose` when dismissed or timed
 * out.
 */
export function AlertDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Toast
      id={title}
      variant="warning"
      duration={10000}
      onDismiss={onClose}
      message={
        <div role="alert" style={{ lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{title}</div>
          <div>{children}</div>
        </div>
      }
    />
  );
}

/**
 * Shown instead of generating a report while there are staged-but-unsaved
 * edits (see utils/unsavedWork.ts) for the dates the report covers - a
 * report only reads saved data, so it would silently leave those edits out.
 * Each line links to the page where they can be saved.
 */
export function UnsavedWorkDialog({
  items,
  onClose,
}: {
  items: UnsavedWorkItem[];
  onClose: () => void;
}) {
  return (
    <AlertDialog title="Unsaved changes" onClose={onClose}>
      <p style={{ margin: 0 }}>
        Please save your changes before generating a report.
      </p>
      <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
        {items.map((item) => (
          <li
            key={`${item.page}:${item.date}:${item.shift}:${item.location ?? ""}`}
          >
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
