/// Opens the page's date picker (the DateStepper in the toolbar). Used by the Save review dialog's
/// "Change date" button, after the dialog has closed: the tiny delay lets the dialog hand focus back
/// first, so the calendar isn't closed again by that focus change.
export function openDatePicker() {
  window.setTimeout(() => {
    document.querySelector<HTMLButtonElement>(".ae-datestep .ae-date-trigger")?.click();
  }, 60);
}
