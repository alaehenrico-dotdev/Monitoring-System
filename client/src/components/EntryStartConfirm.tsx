import { useCallback, useMemo, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { Modal } from "./Modal";
import { Button } from "./ui";
import { formatDateLong } from "../utils/dateFormat";
import { shiftWithWord } from "../utils/shift";
import type { Shift } from "../types";

/**
 * "Is this the right date?" check before an encoder starts typing on a FRESH sheet - one with nothing
 * saved and nothing staged for this date+shift. The first click/focus on a grid cell is held back and the
 * dialog opens in the centre of the screen; confirming focuses that same cell. Asked once per date+shift
 * per page visit, and never on a sheet that already has data or can't be edited.
 */
export function useEntryStartConfirm({
  date,
  shift,
  active,
  fresh,
}: {
  date: string;
  shift: Shift;
  /** False when the sheet is read-only or still loading - never ask then. */
  active: boolean;
  /** True when no row has a saved entry and nothing is staged. */
  fresh: boolean;
}) {
  const sheetKey = `${date}|${shift}`;
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const target = useRef<HTMLElement | null>(null);
  const needed = active && fresh && confirmedKey !== sheetKey;

  const intercept = useCallback(
    (e: FocusEvent<HTMLElement> | MouseEvent<HTMLElement>) => {
      if (!needed) return;
      const el = e.target as HTMLElement;
      if (!el.matches?.("input[data-cell]")) return;
      e.preventDefault();
      target.current = el;
      el.blur();
      setAsking(true);
    },
    [needed],
  );

  const confirm = useCallback(() => {
    setConfirmedKey(sheetKey);
    setAsking(false);
    const el = target.current;
    target.current = null;
    // After the dialog unmounts, so the focus isn't stolen back by it.
    setTimeout(() => {
      el?.focus();
      (el as HTMLInputElement | null)?.select?.();
    }, 0);
  }, [sheetKey]);

  const cancel = useCallback(() => {
    setAsking(false);
    target.current = null;
  }, []);

  // No handlers at all once the sheet is confirmed, has data or can't be edited - the grid then pays
  // nothing per click/focus.
  const gridProps = useMemo(
    () => (needed ? { onMouseDownCapture: intercept, onFocusCapture: intercept } : {}),
    [needed, intercept],
  );

  return {
    asking: asking && needed,
    /** Spread on the element wrapping the grid. */
    gridProps,
    confirm,
    cancel,
  };
}

export function EntryStartConfirm({
  date,
  shift,
  page,
  onConfirm,
  onChangeDate,
  onClose,
}: {
  date: string;
  shift: Shift;
  page: string;
  onConfirm: () => void;
  onChangeDate: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Confirm date" onClose={onClose} width={420}>
      <div className="ae-startconfirm">
        <div className="ae-startconfirm-date" role="group" aria-label="Sheet you are about to enter on">
          <div className="ae-startconfirm-page">{page}</div>
          <div className="ae-startconfirm-day">{formatDateLong(date)}</div>
          <div className="ae-startconfirm-shift">{shiftWithWord(shift)}</div>
        </div>
        <p className="ae-startconfirm-text">You're about to start entering on a new sheet. Is this the right date?</p>
        <div className="ae-startconfirm-actions">
          <Button type="button" variant="secondary" size="sm" onClick={onChangeDate}>
            Change date
          </Button>
          <Button type="button" size="sm" onClick={onConfirm} autoFocus>
            Yes, start entry
          </Button>
        </div>
      </div>
    </Modal>
  );
}
