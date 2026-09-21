/**
 * Client-side receipt PDF generator.
 *
 * Mirrors receipts.py's approach: a two-pass render (dry run to measure
 * total content height, then a real draw onto a page sized to fit exactly)
 * so the output is always a single small page sized to the thermal paper
 * width and the receipt's real content height — never a full Letter/A4
 * page with the receipt shrunk into a corner.
 *
 * This intentionally bypasses window.print()/the browser's native Print
 * dialog entirely. Calling generateReceiptPdf() produces a real PDF file
 * and triggers a normal "Save File" prompt, the same experience as
 * receipts.py just returning PDF bytes for the browser to download.
 *
 * Dependencies to install in the client package:
 *   npm install jspdf qrcode
 *   npm install -D @types/qrcode   (jsPDF ships its own types)
 */
// Type-only import (see the matching note in utils/tablePdf.ts) - jspdf and
// qrcode are only actually loaded, via dynamic import(), inside
// generateReceiptPdf below, at the moment someone clicks "PDF" on a receipt.
import type jsPDF from "jspdf";
import type { Receipt } from "../types";

// ---- Palette (from theme.ts's `colors`) ----
// These are the FIXED/static values (staticInk, staticSubtleInk, goldDark,
// red) — the ones ReceiptCard.tsx uses for the always-white-paper receipt
// look, not the CSS-variable tokens that flip with light/dark mode.
const INK = "#241D14";
const SUBTLE_INK = "#6B6255";
const GOLD_DARK = "#8B6A1E";
const RED = "#C1272D";

const THERMAL_PAPER_SIZES = {
  "58mm": { paperMM: 58, printableMM: 48 },
  "80mm": { paperMM: 80, printableMM: 72 },
} as const;

export type ThermalPaperSize = keyof typeof THERMAL_PAPER_SIZES;

function pad(id: number): string {
  return String(id).padStart(6, "0");
}

// Same value as ReceiptCard.tsx's receiptQrValue(): the server-issued
// encrypted token (receipt.qrToken), not the plain id - see
// server/src/utils/receiptQrToken.ts for why this is the one id in the app
// that's actually encrypted rather than a plain integer.
function receiptQrValue(receipt: Receipt): string {
  return receipt.qrToken;
}

/**
 * Static (non-JSX) recreation of LogoMark.tsx's seal artwork, with the
 * theme's hex values inlined directly, so it can be rasterized to a PNG
 * for embedding — jsPDF can only place raster/vector images it's given,
 * it can't render a React component.
 */
function logoSvgMarkup(px: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 200 200">
    <defs>
      <path id="ala-eh-top-arc" d="M 20 72 A 85 85 0 0 1 180 72" />
      <path id="ala-eh-bottom-arc" d="M 35.5 154 A 85 85 0 0 0 164.5 154" />
    </defs>
    <circle cx="100" cy="100" r="97" fill="#14110D" stroke="#C99A2E" stroke-width="6" />
    <circle cx="100" cy="100" r="85" fill="none" stroke="#C99A2E" stroke-width="1.5" opacity="0.6" />
    <text font-family="Georgia, serif" font-size="11.5" font-weight="700" letter-spacing="2.2" fill="#F1E9D0">
      <textPath href="#ala-eh-top-arc" startOffset="50%" text-anchor="middle">SPECIALLY MADE RECIPE</textPath>
    </text>
    <text font-family="Georgia, serif" font-size="10.5" font-weight="700" letter-spacing="1.1" fill="#F1E9D0">
      <textPath href="#ala-eh-bottom-arc" startOffset="50%" text-anchor="middle">SA PANLASANG PINOY</textPath>
    </text>
    <path d="M55 85 Q100 40 145 85 Z" fill="#C99A2E" />
    <ellipse cx="100" cy="85" rx="45" ry="6.5" fill="#8B6A1E" />
    <ellipse cx="74" cy="68" rx="9" ry="3.5" fill="#fff" opacity="0.85" transform="rotate(-25 74 68)" />
    <ellipse cx="123" cy="64" rx="6.5" ry="2.5" fill="#fff" opacity="0.7" transform="rotate(-15 123 64)" />
    <rect x="30" y="93" width="140" height="40" rx="20" fill="#C1272D" />
    <text x="100" y="121" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800"
          font-style="italic" font-size="27" fill="#FFD400" stroke="#14110D" stroke-width="1.3" paint-order="stroke">
      Ala Eh!
    </text>
    <text x="100" y="141" text-anchor="middle" font-family="Georgia, serif" font-weight="700"
          letter-spacing="1.3" font-size="9.5" fill="#F1E9D0">
      FOOD PRODUCTS
    </text>
  </svg>`;
}

/** Rasterize an SVG markup string to a PNG data URL, at 2x for crisp embedding. */
function svgToPngDataUrl(svgMarkup: string, px: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = px * scale;
      canvas.height = px * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Canvas 2D context unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to rasterize logo SVG"));
    };
    img.src = url;
  });
}

interface Assets {
  logoDataUrl: string;
  qrDataUrl: string;
}

interface RenderOpts {
  contentWidthMM: number;
  marginMM: number;
  topY: number;
}

/**
 * Draws (or, when `doc` is null, just measures) the full receipt starting
 * at `opts.topY`, returning the total content height in mm. Called once
 * with doc=null (pass 1, sizing) and once with a real doc sized to fit
 * (pass 2, drawing) — identical layout both times, exactly like
 * receipts.py's `dry` parameter.
 */
function renderReceipt(doc: jsPDF | null, receipt: Receipt, assets: Assets, opts: RenderOpts): number {
  const dry = doc === null;
  const { contentWidthMM, marginMM, topY } = opts;
  const xLeft = marginMM;
  const xRight = marginMM + contentWidthMM;
  const xCenter = marginMM + contentWidthMM / 2;
  let y = topY;

  function center(text: string, size: number, opts2: { bold?: boolean; color?: string; gap?: number } = {}) {
    if (!dry) {
      doc!.setFont("courier", opts2.bold ? "bold" : "normal");
      doc!.setFontSize(size);
      doc!.setTextColor(opts2.color ?? INK);
      doc!.text(text, xCenter, y, { align: "center" });
    }
    y += opts2.gap ?? size * 0.55;
  }

  function divider(dashed: boolean, gap: number) {
    if (!dry) {
      doc!.setDrawColor(GOLD_DARK);
      doc!.setLineWidth(0.15);
      doc!.setLineDashPattern(dashed ? [0.8, 0.8] : [0.15, 0.6], 0);
      doc!.line(xLeft, y, xRight, y);
      doc!.setLineDashPattern([], 0);
    }
    y += gap;
  }

  function row(label: string, value: string, opts2: { bold?: boolean; size?: number; gap?: number } = {}) {
    const size = opts2.size ?? 9;
    if (!dry) {
      doc!.setFont("courier", "normal");
      doc!.setFontSize(size);
      doc!.setTextColor(SUBTLE_INK);
      doc!.text(label, xLeft, y);
      doc!.setFont("courier", opts2.bold ? "bold" : "normal");
      doc!.setTextColor(INK);
      doc!.text(value, xRight, y, { align: "right" });
    }
    y += opts2.gap ?? size * 0.5;
  }

  function itemRow(name: string, qty: number, gap = 4.4) {
    const size = 9;
    if (!dry) {
      doc!.setFont("courier", "normal");
      doc!.setFontSize(size);
      doc!.setTextColor(INK);
      const qtyText = `x${qty}`;
      const qtyWidth = doc!.getTextWidth(qtyText);
      const maxNameWidth = contentWidthMM - qtyWidth - 3;
      let displayName = name;
      while (doc!.getTextWidth(displayName) > maxNameWidth && displayName.length > 1) {
        displayName = displayName.slice(0, -1);
      }
      if (displayName !== name) displayName = `${displayName.slice(0, -1)}\u2026`;
      doc!.text(displayName, xLeft, y);
      doc!.text(qtyText, xRight, y, { align: "right" });
    }
    y += gap;
  }

  function image(dataUrl: string, sizeMM: number, gap: number) {
    if (!dry) doc!.addImage(dataUrl, "PNG", xCenter - sizeMM / 2, y, sizeMM, sizeMM);
    y += sizeMM + gap;
  }

  // ---- Letterhead ----
  y += 2;
  image(assets.logoDataUrl, 15, 3);
  center("ALA EH! FOOD PRODUCTS", 12, { bold: true, color: RED, gap: 6 });
  center("S A L E S   R E C E I P T", 7.5, { color: SUBTLE_INK, gap: 5 });
  divider(false, 4.5);

  // ---- Meta rows ----
  row("Receipt #", `#${pad(receipt.id)}`);
  row("Date", receipt.orderDate.slice(0, 10));
  row("Customer", receipt.customer || "\u2014");
  row("Location", receipt.location || "\u2014");
  row("Sales Rep", receipt.salesRepName || "\u2014", { gap: 5 });
  divider(false, 4.5);

  // ---- Items ----
  if (receipt.items.length === 0) {
    center("No items", 9, { color: SUBTLE_INK, gap: 5 });
  } else {
    for (const it of receipt.items) {
      itemRow(it.product.name, Number(it.quantity));
    }
  }
  divider(false, 4.5);

  // ---- Total ----
  const totalItems = receipt.items.reduce((sum, it) => sum + Number(it.quantity), 0);
  row("TOTAL ITEMS", String(totalItems), { bold: true, size: 10, gap: 6 });
  divider(true, 5.5);

  // ---- QR + footer ----
  image(assets.qrDataUrl, 22, 3.5);
  center(`Logged by ${receipt.createdBy?.name ?? "system"}`, 7.2, { color: SUBTLE_INK, gap: 4.5 });
  center("* * * THANK YOU! * * *", 8, { bold: true, gap: 2 });
  y += 3;

  return y - topY;
}

/**
 * Generate and download a receipt PDF sized exactly to the chosen thermal
 * paper width and this receipt's real content height, then trigger a
 * normal browser "Save File" prompt — no window.print(), no native Print
 * dialog.
 */
export async function generateReceiptPdf(
  receipt: Receipt,
  paperSize: ThermalPaperSize = "58mm"
): Promise<void> {
  const { paperMM, printableMM } = THERMAL_PAPER_SIZES[paperSize];
  const marginMM = (paperMM - printableMM) / 2;

  const [{ default: JsPDF }, { default: QRCode }, logoDataUrl] = await Promise.all([
    import("jspdf"),
    import("qrcode"),
    svgToPngDataUrl(logoSvgMarkup(200), 200),
  ]);
  const qrDataUrl = await QRCode.toDataURL(receiptQrValue(receipt), { margin: 0, width: 300, color: { dark: INK } });
  const assets: Assets = { logoDataUrl, qrDataUrl };

  // Pass 1 (dry): measure only.
  const contentHeight = renderReceipt(null, receipt, assets, {
    contentWidthMM: printableMM,
    marginMM,
    topY: 0,
  });

  // Pass 2 (real): draw onto a page sized to fit exactly what pass 1 measured.
  const doc = new JsPDF({ unit: "mm", format: [paperMM, contentHeight] });
  doc.setProperties({ title: `Receipt #${pad(receipt.id)}` });
  renderReceipt(doc, receipt, assets, { contentWidthMM: printableMM, marginMM, topY: 0 });

  doc.save(`Receipt-${pad(receipt.id)}.pdf`);
}