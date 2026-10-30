import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Toast } from "./Toast";

describe("Toast", () => {
  it("shows the variant badge by default", () => {
    render(<Toast message="Saved" onDismiss={() => {}} variant="success" />);
    expect(screen.getByRole("img", { name: "Success" })).toBeTruthy();
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("leaves the badge out when the message carries its own indicator", () => {
    render(<Toast message="Backing up to Google Drive…" onDismiss={() => {}} variant="info" hideIcon />);
    expect(screen.queryByRole("img", { name: "Information" })).toBeNull();
    expect(screen.getByText("Backing up to Google Drive…")).toBeTruthy();
    // The dismiss button is still there.
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });
});
