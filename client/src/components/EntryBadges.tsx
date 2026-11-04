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

/// The chip beside an entry page's title saying where the sheet stands. The date and shift are
/// in the title itself ("Daily Online Stock Monitoring - November 4, 2026 - Daily Sheet").
export function EntryBadges({ status }: { status: EntryStatus }) {
  return (
    <span className="ae-entry-badges">
      <span className={`ae-entry-badge ae-entry-badge--${status}`} title={STATUS_TITLE[status]}>
        {STATUS_LABEL[status]}
      </span>
    </span>
  );
}
