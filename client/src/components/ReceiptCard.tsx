import type { CSSProperties, ReactNode } from "react";
import type { Receipt } from "../types";
import { colors, fonts } from "../theme";
import { LogoMark } from "./LogoMark";

export const RECEIPT_CARD_WIDTH = 300;
const TOOTH = 18; // px per zigzag segment along the bottom edge
const DEPTH = 11; // px the zigzag dips down

/// Deterministic sawtooth clip-path for the bottom edge, computed from a
/// fixed card width - reads as a torn thermal-receipt edge without relying on
/// finicky CSS mask/background-position math.
function zigzagBottomClipPath(width: number, tooth: number, depth: number): string {
  const teeth = Math.max(2, Math.round(width / tooth));
  const points: string[] = ["0 0", "100% 0", `100% calc(100% - ${depth}px)`];
  for (let i = teeth - 1; i >= 0; i--) {
    const x = (i / teeth) * 100;
    const atNotch = i % 2 === 0;
    points.push(`${x}% ${atNotch ? "100%" : `calc(100% - ${depth}px)`}`);
  }
  points.push(`0 calc(100% - ${depth}px)`);
  return `polygon(${points.join(", ")})`;
}

/**
 * The shared "paper" shell - background, border, torn zigzag edge, and the
 * centered logo header - factored out so the read-only output card and the
 * editable entry form (ReceiptsPage) render as the exact same physical
 * receipt, one with static text, one with inputs in place of the values.
 */
export function ReceiptPaper({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      style={{
        width: RECEIPT_CARD_WIDTH,
        background: "#FFFFFF",
        fontFamily: "'Courier New', Courier, monospace",
        color: colors.ink,
        // A visible outline (not just a shadow) so the torn/zigzag bottom
        // edge reads clearly even though the card and page background are
        // close in tone - a shadow alone washes out against warm paper tones.
        border: `1.5px solid ${colors.goldDark}`,
        boxShadow: "0 8px 18px rgba(20,17,13,0.22)",
        clipPath: zigzagBottomClipPath(RECEIPT_CARD_WIDTH, TOOTH, DEPTH),
        padding: "20px 22px",
        paddingBottom: DEPTH + 16,
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 10 }}>
        <LogoMark size={40} />
        <div style={{ fontFamily: fonts.wordmark, fontWeight: 800, color: colors.red, fontSize: 14, marginTop: 6 }}>
          ALA EH! FOOD PRODUCTS
        </div>
        <div style={{ fontSize: 10, letterSpacing: 2, color: colors.subtleInk }}>SALES RECEIPT</div>
      </div>
      {children}
    </div>
  );
}

/// Read-only rendering of a saved (or live-preview) receipt. `isPreview`
/// softens a couple of lines that don't make sense before the receipt has
/// actually been saved (no receipt number yet, no "logged by" audit trail).
export function ReceiptCard({ receipt, isPreview }: { receipt: Receipt; isPreview?: boolean }) {
  const totalItems = receipt.items.reduce((sum, it) => sum + Number(it.quantity), 0);

  return (
    <ReceiptPaper testId="receipt-card">
      <Divider />
      <Row label="Receipt #" value={isPreview ? "(unsaved)" : `#${String(receipt.id).padStart(6, "0")}`} />
      <Row label="Date" value={receipt.orderDate.slice(0, 10)} />
      <Row label="Customer" value={receipt.customer || "—"} />
      <Row label="Location" value={receipt.location || "—"} />
      <Row label="Sales Rep" value={receipt.salesRepName || "—"} />
      <Divider />

      {receipt.items.length === 0 ? (
        <div style={{ fontSize: 12, color: colors.subtleInk, textAlign: "center", padding: "6px 0" }}>No items yet</div>
      ) : (
        receipt.items.map((it) => (
          <div key={it.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, marginBottom: 3 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.product.name}</span>
            <span style={{ flexShrink: 0 }}>x{Number(it.quantity)}</span>
          </div>
        ))
      )}

      <Divider />
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 13 }}>
        <span>TOTAL ITEMS</span>
        <span>{totalItems}</span>
      </div>
      <Divider dashed />

      <div style={{ textAlign: "center", fontSize: 10.5, color: colors.subtleInk, marginTop: 8 }}>
        {isPreview ? (
          <div style={{ fontWeight: 700, letterSpacing: 1, color: colors.warningText }}>PREVIEW - NOT YET SAVED</div>
        ) : (
          <>
            <div>Logged by {receipt.createdBy?.name ?? "system"}</div>
            <div style={{ marginTop: 6, fontWeight: 700, letterSpacing: 1.5, color: colors.ink }}>* * * THANK YOU! * * *</div>
          </>
        )}
      </div>
    </ReceiptPaper>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  const style: CSSProperties = {
    fontWeight: 600,
    textAlign: "right",
    maxWidth: 190,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, marginBottom: 2 }}>
      <span style={{ color: colors.subtleInk, flexShrink: 0 }}>{label}</span>
      <span style={style}>{value}</span>
    </div>
  );
}

export function Divider({ dashed }: { dashed?: boolean }) {
  return <div style={{ borderTop: `1px ${dashed ? "dashed" : "dotted"} ${colors.goldDark}`, margin: "8px 0" }} />;
}
