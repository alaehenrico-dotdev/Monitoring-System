import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EntryRulesSettings } from "./EntryRulesSettings";

const api = vi.hoisted(() => ({ getEntryRules: vi.fn(), updateEntryRules: vi.fn() }));
vi.mock("../api/appSettings", () => api);

beforeEach(() => {
  vi.clearAllMocks();
  api.getEntryRules.mockResolvedValue({ requireEarlierDaysFinished: true });
});

const find = () => screen.findByRole("checkbox", { name: /Finish days in order/ });
/// Renders the card and waits for the switch to appear.
async function open() {
  render(<EntryRulesSettings />);
  return find();
}

describe("EntryRulesSettings", () => {
  it("shows the rule on by default - nothing changes for anyone until an admin turns it off", async () => {
    expect(await open()).toBeChecked();
    expect(screen.queryByText(/While earlier days are open/)).toBeNull();
  });

  it("turns the rule off the moment it is unticked, and explains what that means", async () => {
    api.updateEntryRules.mockResolvedValue({ requireEarlierDaysFinished: false });
    fireEvent.click(await open());
    await waitFor(() => expect(api.updateEntryRules).toHaveBeenCalledWith({ requireEarlierDaysFinished: false }));
    expect(await screen.findByText(/People can now fill in the present day/)).toBeInTheDocument();
    expect(screen.getByText(/While earlier days are open/)).toHaveTextContent(/Finishing a day still goes in order/);
    expect(await find()).not.toBeChecked();
  });

  it("turns it back on again", async () => {
    api.getEntryRules.mockResolvedValue({ requireEarlierDaysFinished: false });
    api.updateEntryRules.mockResolvedValue({ requireEarlierDaysFinished: true });
    fireEvent.click(await open());
    await waitFor(() => expect(api.updateEntryRules).toHaveBeenCalledWith({ requireEarlierDaysFinished: true }));
    expect(await screen.findByText(/must now be finished in order/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/While earlier days are open/)).toBeNull());
  });

  it("shows the real state, and why, when saving fails", async () => {
    api.updateEntryRules.mockRejectedValue(new Error("Requires role: SUPERVISOR_ADMIN"));
    fireEvent.click(await open());
    expect(await screen.findByText(/Requires role: SUPERVISOR_ADMIN/)).toBeInTheDocument();
    expect(await find()).toBeChecked();
  });

  it("reports a failure to load instead of showing a switch it cannot vouch for", async () => {
    api.getEntryRules.mockRejectedValue(new Error("Network error"));
    render(<EntryRulesSettings />);
    expect(await screen.findByText(/Network error/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
