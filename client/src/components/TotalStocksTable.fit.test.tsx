import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TotalStocksTable } from "./TotalStocksTable";

describe("TotalStocksTable fit", () => {
  it("is content-sized by default", () => {
    const { container } = render(<TotalStocksTable rows={[]} />);
    const table = container.querySelector("table")!;
    expect(table).toHaveClass("ae-table--compact");
    expect(table).not.toHaveClass("ae-table--fit");
  });

  it("stretches to the pane when fitted", () => {
    const { container } = render(<TotalStocksTable rows={[]} fit />);
    expect(container.querySelector("table")).toHaveClass("ae-table--compact", "ae-table--fit");
  });
});
