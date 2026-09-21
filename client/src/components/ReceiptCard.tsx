import type { CSSProperties, ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Receipt } from "../types";
import { colors, fonts } from "../theme";
import { LogoMark } from "./LogoMark";

export const RECEIPT_CARD_WIDTH = 460;
const TOOTH = 18; // px per zigzag segment along the bottom edge
const DEPTH = 11; // px the zigzag dips down

// Physical size of the printed QR box, in the same design pixels as the
// rest of the receipt (RECEIPT_CARD_WIDTH etc). Thermal printers are low-DPI
// and slightly blurry, so this is sized generously enough to still scan
// reliably after `handlePrintReceipt`'s zoom shrinks it down to a 58mm/80mm
// roll - too small here and it degrades to unscannable at print scale.
const QR_SIZE = 84;

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

// What the printed QR code encodes for a saved receipt: the server-issued
// encrypted token (receipt.qrToken - see server/src/utils/receiptQrToken.ts),
// not the plain id. A printed receipt physically leaves the authenticated
// app - anyone can pick it up and scan it - so unlike every other id in
// this app (all plain integers; access here is role-based, not per-owner,
// so a bare id alone doesn't expose anything a valid session couldn't
// already see) this is the one id actually worth not handing out in the
// clear.
function receiptQrValue(receipt: Receipt): string {
  return receipt.qrToken;
}

/**
 * The shared "paper" shell - background, border, torn zigzag edge, and the
 * centered logo header - factored out so the read-only output card and the
 * editable entry form (ReceiptsPage) render as the exact same physical
 * receipt, one with static text, one with inputs in place of the values.
 *
 * `style` is an optional override merged in *after* the shell's own fixed
 * layout properties (width/border/clipPath/padding), so a caller can only
 * add to or override them - e.g. a `zoom` factor to physically shrink the
 * rendered box for an on-screen thermal-size preview - without fighting the
 * clip-path math, which still keys off the same real `RECEIPT_CARD_WIDTH`
 * regardless of any zoom applied on top (`zoom` reflows the box itself, so
 * the polygon and the visual edge still line up at any scale).
 */
export function ReceiptPaper({
  children,
  testId,
  className = "",
  style,
}: {
  children: ReactNode;
  testId?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      data-testid={testId}
      className={`ae-receipt-paper ${className}`.trim()}
      style={{
        width: RECEIPT_CARD_WIDTH,
        background: "#FFFFFF",
        fontFamily: "'Courier New', Courier, monospace",
        color: colors.staticInk,
        // A visible outline (not just a shadow) so the torn/zigzag bottom
        // edge reads clearly even though the card and page background are
        // close in tone - a shadow alone washes out against warm paper tones.
        border: `1.5px solid ${colors.goldDark}`,
        boxShadow: "0 8px 18px rgba(20,17,13,0.22)",
        clipPath: zigzagBottomClipPath(RECEIPT_CARD_WIDTH, TOOTH, DEPTH),
        padding: "28px 32px",
        paddingBottom: DEPTH + 24,
        ...style,
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <LogoMark size={52} />
        <div style={{ fontFamily: fonts.wordmark, fontWeight: 800, color: colors.red, fontSize: 17, marginTop: 8 }}>
          ALA EH! FOOD PRODUCTS
        </div>
        <div style={{ fontSize: 11.5, letterSpacing: 2, color: colors.staticSubtleInk }}>SALES RECEIPT</div>
      </div>
      {children}
    </div>
  );
}

/// Read-only rendering of a saved (or live-preview) receipt. `isPreview`
/// softens a couple of lines that don't make sense before the receipt has
/// actually been saved (no receipt number yet, no "logged by" audit trail) -
/// the QR code is skipped for the same reason: there's nothing stable yet
/// to encode until the receipt has a real, saved id.
///
/// `paperStyle` is passed straight through to the underlying `ReceiptPaper`
/// shell - used by the saved/recent-receipt modal to render this same card
/// at true thermal-roll size (via `zoom`) without affecting the large entry
/// form / live preview pair on the main page, which never pass this prop.
export function ReceiptCard({
  receipt,
  isPreview,
  paperStyle,
}: {
  receipt: Receipt;
  isPreview?: boolean;
  paperStyle?: CSSProperties;
}) {
  const totalItems = receipt.items.reduce((sum, it) => sum + Number(it.quantity), 0);

  return (
    <ReceiptPaper testId="receipt-card" style={paperStyle}>
      <Divider />
      <Row label="Receipt #" value={isPreview ? "(unsaved)" : `#${String(receipt.id).padStart(6, "0")}`} />
      <Row label="Date" value={receipt.orderDate.slice(0, 10)} />
      <Row label="Customer" value={receipt.customer || "—"} />
      <Row label="Location" value={receipt.location || "—"} />
      <Row label="Sales Rep" value={receipt.salesRepName || "—"} />
      <Divider />

      {receipt.items.length === 0 ? (
        <div style={{ fontSize: 13, color: colors.staticSubtleInk, textAlign: "center", padding: "8px 0" }}>No items yet</div>
      ) : (
        receipt.items.map((it) => (
          <div key={it.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, marginBottom: 4 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.product.name}</span>
            <span style={{ flexShrink: 0 }}>x{Number(it.quantity)}</span>
          </div>
        ))
      )}

      <Divider />
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 14 }}>
        <span>TOTAL ITEMS</span>
        <span>{totalItems}</span>
      </div>
      <Divider dashed />

      {!isPreview && (
        // Rendered as SVG (not canvas) specifically because this same
        // markup gets cloned verbatim into the print-only iframe in
        // ReceiptsPage.handlePrintReceipt - a canvas's drawn bitmap
        // wouldn't survive that outerHTML clone, but an SVG's markup does,
        // and it also stays crisp under the iframe's `zoom` scaling instead
        // of pixelating like a fixed-resolution raster would.
        <div style={{ display: "flex", justifyContent: "center", margin: "10px 0 2px" }}>
          <QRCodeSVG value={receiptQrValue(receipt)} size={QR_SIZE} level="M" />
        </div>
      )}

      <div style={{ textAlign: "center", fontSize: 11.5, color: colors.staticSubtleInk, marginTop: 10 }}>
        {isPreview ? (
          <div style={{ fontWeight: 700, letterSpacing: 1, color: colors.warningText }}>PREVIEW - NOT YET SAVED</div>
        ) : (
          <>
            <div>Logged by {receipt.createdBy?.name ?? "system"}</div>
            <div style={{ marginTop: 6, fontWeight: 700, letterSpacing: 1.5, color: colors.staticInk }}>* * * THANK YOU! * * *</div>
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
    maxWidth: 320,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, marginBottom: 3 }}>
      <span style={{ color: colors.staticSubtleInk, flexShrink: 0 }}>{label}</span>
      <span style={style}>{value}</span>
    </div>
  );
}

export function Divider({ dashed }: { dashed?: boolean }) {
  return <div style={{ borderTop: `1px ${dashed ? "dashed" : "dotted"} ${colors.goldDark}`, margin: "8px 0" }} />;
}