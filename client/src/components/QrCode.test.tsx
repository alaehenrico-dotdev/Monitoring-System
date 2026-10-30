import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QrCode } from "./QrCode";

describe("QrCode", () => {
  it("renders the value as an image the viewer can scan", async () => {
    render(<QrCode value="otpauth://totp/Ala%20Eh:ana?secret=ABCDEFGH" label="scan me" />);
    const img = (await screen.findByAltText("scan me")) as HTMLImageElement;
    expect(img.src.startsWith("data:image/svg+xml")).toBe(true);
    expect(decodeURIComponent(img.src)).toContain("<svg");
  });
});
