import { addDaysIso } from "../utils/dateMath";
import { DatePicker } from "./DatePicker";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

/**
 * The date control: previous day, the date itself (the existing picker), next
 * day, and a "Today" shortcut. Stepping a day at a time is what an encoder does
 * most, so it should not take opening a calendar.
 *
 * "Today" means the current BUSINESS day (`todayValue`, which the caller takes
 * from getCurrentShiftAndDate): just after midnight that is still yesterday's
 * Night shift, and jumping to the new calendar day would open a near-empty sheet.
 * It stays visible but unavailable when already there, with the reason as its
 * tooltip, rather than vanishing and shifting the bar around.
 */
export function DateStepper({ value, onChange, todayValue }: { value: string; onChange: (date: string) => void; todayValue: string }) {
  const atToday = value === todayValue;
  return (
    <div role="group" aria-label="Date" className="ae-datestep">
      <button type="button" className="ae-mb-btn ae-mb-btn--icon" aria-label="Previous day" title="Previous day" onClick={() => onChange(addDaysIso(value, -1))}>
        <ChevronLeftIcon />
      </button>
      <DatePicker aria-label="Date" value={value} onChange={onChange} todayValue={todayValue} style={{ maxWidth: 180 }} />
      <button type="button" className="ae-mb-btn ae-mb-btn--icon" aria-label="Next day" title="Next day" onClick={() => onChange(addDaysIso(value, 1))}>
        <ChevronRightIcon />
      </button>
      <button
        type="button"
        className="ae-mb-btn ae-datestep-today"
        aria-disabled={atToday || undefined}
        title={atToday ? "Already on today" : "Jump to today"}
        onClick={() => !atToday && onChange(todayValue)}
      >
        Today
      </button>
    </div>
  );
}
