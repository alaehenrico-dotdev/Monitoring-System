import type { ReactNode } from "react";
import { Modal } from "./Modal";
import { Button } from "./ui";

/**
 * "Are you sure?" step for actions that hide or remove something (e.g.
 * deactivating a SKU). Built on the shared Modal, so it gets the same
 * backdrop, Escape-to-close and click-outside-to-cancel as every other
 * dialog. Cancel is auto-focused so a stray Enter never confirms.
 *
 * While `busy` (the confirmed action is in flight) both buttons are
 * disabled and the dialog can't be dismissed, so it can't be double-fired.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  /// The confirm button cannot be pressed (the dialog explains why in its body),
  /// while Cancel still works. For an action that has a blocking problem.
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={busy ? () => {} : onCancel} width={420}>
      <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{children}</div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Button variant="secondary" onClick={onCancel} disabled={busy} autoFocus>
          Cancel
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={busy || confirmDisabled}>
          {busy ? "Working…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}