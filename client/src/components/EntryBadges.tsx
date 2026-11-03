import type { Shift } from "../types";
import { formatDateDisplay } from "../utils/dateFormat";
import { SHIFT_LABELS } from "../utils/shift";

export type EntryStatus = "open" | "finished" | "blocked" | "view" | "split";

const STATUS_LABEL: Record<EntryStatus, string> = {
  open: "Open",
  finished: "Finished",
  blocked: "Finish earlier day first",
  view: "View only",
  split: "By shift · view only",
};

const STATUS_TITLE: Record<EntryStatus, string> = {
  open: "You can enter and save on this sheet.",
  finished: "This sheet is finished and locked.",
  blocked: "Days are finished in order, so this sheet is read-only until the earlier day is finished.",
  view: "Your role can view this page but not edit it.",
  split: "This day was entered by shift; with shifts switched off it shows the two added together, read-only.",
};

/// The chips that sit beside an entry page's title: the date, the shift and where the sheet
/// stands. They carry what the old long title ("Daily Online Stock Monitoring - Nov 3 - Night
/// Shift") spelled out, so the title itself can stay short.
export function EntryBadges({ date, shift, status }: { date: string; shift: Shift; status: EntryStatus }) {
  return (
    <span className="ae-entry-badges">
      <span className="ae-entry-badge">{formatDateDisplay(date)}</span>
      <span className="ae-entry-badge">{SHIFT_LABELS[shift]}</span>
      <span className={`ae-entry-badge ae-entry-badge--${status}`} title={STATUS_TITLE[status]}>
        {STATUS_LABEL[status]}
      </span>
    </span>
  );
}
