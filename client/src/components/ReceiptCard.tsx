import type { CSSProperties } from "react";
import type { Receipt } from "../types";
import { colors, fonts } from "../theme";
import { LogoMark } from "./LogoMark";

const CARD_WIDTH = 300;
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

export function ReceiptCard({ receipt }: { receipt: Receipt }) {
  const totalItems = receipt.items.reduce((sum, it) => sum + Number(it.quantity), 0);

  return (
    <div
      data-testid="receipt-card"
      style={{
        width: CARD_WIDTH,
        background: "#FFFFFF",
        fontFamily: "'Courier New', Courier, monospace",
        color: colors.ink,
        // A visible outline (not just a shadow) so the torn/zigzag bottom
        // edge reads clearly even though the card and page background are
        // close in tone - a shadow alone washes out against warm paper tones.
        border: `1.5px solid ${colors.goldDark}`,
        boxShadow: "0 8px 18px rgba(20,17,13,0.22)",
        clipPath: zigzagBottomClipPath(CARD_WIDTH, TOOTH, DEPTH),
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

      <Divider />
      <Row label="Receipt #" value={`#${String(receipt.id).padStart(6, "0")}`} />
      <Row label="Date" value={receipt.orderDate.slice(0, 10)} />
      <Row label="Customer" value={receipt.customer} />
      <Row label="Location" value={receipt.location} />
      <Row label="Sales Rep" value={receipt.salesRep?.name ?? "—"} />
      <Divider />

      {receipt.items.map((it) => (
        <div key={it.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, marginBottom: 3 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.product.name}</span>
          <span style={{ flexShrink: 0 }}>x{Number(it.quantity)}</span>
        </div>
      ))}

      <Divider />
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 13 }}>
        <span>TOTAL ITEMS</span>
        <span>{totalItems}</span>
      </div>
      <Divider dashed />

      <div style={{ textAlign: "center", fontSize: 10.5, color: colors.subtleInk, marginTop: 8 }}>
        <div>Logged by {receipt.createdBy?.name ?? "system"}</div>
        <div style={{ marginTop: 6, fontWeight: 700, letterSpacing: 1.5, color: colors.ink }}>* * * THANK YOU! * * *</div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
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

function Divider({ dashed }: { dashed?: boolean }) {
  return <div style={{ borderTop: `1px ${dashed ? "dashed" : "dotted"} ${colors.goldDark}`, margin: "8px 0" }} />;
}
