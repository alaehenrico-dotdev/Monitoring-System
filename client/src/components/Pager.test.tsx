import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { Pager } from "./Pager";

const pager = (props: Partial<React.ComponentProps<typeof Pager>> = {}) =>
  render(<Pager page={1} pageSize={10} total={160} onPage={vi.fn()} {...props} />);

describe("Pager", () => {
  it("shows the exact total", () => {
    const { container } = pager();
    expect(container.textContent).toContain("1–10 of 160");
    expect(container.textContent).not.toContain("160+");
  });

  it("marks a total that stopped at the server's cap as \"10,000+\"", () => {
    const { container } = pager({ total: 10000, totalCapped: true });
    expect(container.textContent).toContain("of 10,000+");
  });

  it("has nothing to show when everything fits on the smallest page size", () => {
    const { container } = pager({ total: 8 });
    expect(container.textContent).toBe("");
  });
});
