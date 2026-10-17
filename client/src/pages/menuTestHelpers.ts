import { fireEvent, screen } from "@testing-library/react";

/// Opens a menu-bar menu by its visible name and chooses one of its items, the
/// way a person does: click the menu, then click the item.
export function chooseFromMenu(menu: string, item: RegExp | string) {
  fireEvent.click(screen.getAllByRole("menuitem", { name: new RegExp(`^${menu}`) })[0]);
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}

/// Opens a menu-bar menu and returns the item without choosing it, to look at
/// whether it is available.
export function menuItem(menu: string, item: RegExp | string) {
  fireEvent.click(screen.getAllByRole("menuitem", { name: new RegExp(`^${menu}`) })[0]);
  return screen.getByRole("menuitem", { name: item });
}
