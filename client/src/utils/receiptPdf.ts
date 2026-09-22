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
 * Loads a static public asset (client/public/logo.jpg, the real Ala Eh!
 * seal - see components/LogoMark.tsx) as a base64 data URL, for embedding
 * via jsPDF's addImage - it needs actual image data, not a URL it fetches
 * itself and it can't render a React component either way.
 */
function loadImageAsDataUrl(url: string): Promise<string> {
  return fetch(url)
    .then((res) => res.blob())
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error(`Failed to load ${url}`));
          reader.readAsDataURL(blob);
        }),
    );
}

/// jsPDF's addImage needs to be told the format explicitly - read it off
/// the data URL's mime prefix rather than hardcoding one, since the logo
/// (JPEG, see loadImageAsDataUrl) and the QR code (PNG, from the `qrcode`
/// package's own toDataURL) go through the same image() helper below.
function addImageFormat(dataUrl: string): "JPEG" | "PNG" {
  return dataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
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
    if (!dry) doc!.addImage(dataUrl, addImageFormat(dataUrl), xCenter - sizeMM / 2, y, sizeMM, sizeMM);
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
    loadImageAsDataUrl("/logo.jpg"),
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