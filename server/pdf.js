import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Server-side invoice PDF.
 *
 * The document is rendered from persisted invoice rows only (never from a
 * request body), so the downloaded file always shows the same numbers the API
 * returns. Nothing is written to disk: the bytes are returned in memory, which
 * keeps the endpoint safe on serverless hosts.
 *
 * pdf-lib's standard fonts use WinAnsi encoding, which cannot represent every
 * Unicode character (the rupee sign, for example). Text is normalised before it
 * is drawn and money is printed as "INR 1,234.00" so the file renders the same
 * everywhere.
 */

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 46;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;

const COLOR = {
  ink: rgb(0.06, 0.09, 0.16),
  soft: rgb(0.2, 0.25, 0.33),
  muted: rgb(0.39, 0.45, 0.55),
  line: rgb(0.89, 0.91, 0.94),
  brand: rgb(0.15, 0.39, 0.92),
  brandSoft: rgb(0.94, 0.96, 1),
  head: rgb(0.12, 0.16, 0.23),
  white: rgb(1, 1, 1),
};

const REPLACEMENTS = {
  "\u2014": "-",
  "\u2013": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u2026": "...",
  "\u20b9": "INR ",
  "\u00d7": "x",
  "\u2192": "->",
  "\u00b7": ".",
  "\u2022": "-",
  "\u00a0": " ",
  "\t": " ",
  "\r": " ",
  "\n": " ",
};

/** Normalise text to something the standard PDF fonts can draw. */
export function pdfText(value, fallback = "") {
  if (value == null) return fallback;
  const mapped = String(value).replace(/[^\x20-\x7e\xa0-\xff]|[\u2010-\u203a\u20b9]/g, (char) => REPLACEMENTS[char] ?? "?");
  return mapped.replace(/[ ]{2,}/g, " ").trim() || fallback;
}

export function pdfMoney(value, currency) {
  const amount = Number(value);
  const formatted = Number.isFinite(amount)
    ? amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
  return `${pdfText(currency, "")} ${formatted}`.trim();
}

export function pdfDate(value) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  // Document dates are stored as UTC midnight, so format them in UTC as well:
  // the PDF then shows the same calendar day as the API and the web UI.
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function wrap(text, font, size, maxWidth) {
  const words = pdfText(text).split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

class Writer {
  constructor(doc, fonts) {
    this.doc = doc;
    this.fonts = fonts;
    this.page = doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN;
    this.pageNumber = 1;
  }

  get bottom() {
    return MARGIN + 34;
  }

  text(value, { x = MARGIN, size = 10, bold = false, color = COLOR.ink, align = "left", width } = {}) {
    const font = bold ? this.fonts.bold : this.fonts.regular;
    const line = pdfText(value);
    const textWidth = font.widthOfTextAtSize(line, size);
    let drawX = x;
    if (align === "right" && width) drawX = x + width - textWidth;
    if (align === "center" && width) drawX = x + (width - textWidth) / 2;
    this.page.drawText(line, { x: drawX, y: this.y, size, font, color });
    return textWidth;
  }

  moveDown(amount) {
    this.y -= amount;
  }

  rule(color = COLOR.line, thickness = 0.8) {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE.width - MARGIN, y: this.y },
      thickness,
      color,
    });
  }

  box(x, y, width, height, color) {
    this.page.drawRectangle({ x, y, width, height, color });
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pageNumber += 1;
    this.y = PAGE.height - MARGIN;
  }

  ensure(space) {
    if (this.y - space < this.bottom) {
      this.newPage();
      return true;
    }
    return false;
  }
}

/**
 * @param {object} invoice invoice row with items, vendor, rfq and purchaseOrder
 * @param {object} options { generatedAt, issuer }
 * @returns {Promise<Uint8Array>}
 */
export async function renderInvoicePdf(invoice, { generatedAt = new Date(), issuer = "VendorBridge" } = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${invoice.number}`);
  doc.setSubject(`System-generated pro forma invoice ${invoice.number}`);
  doc.setProducer("VendorBridge");
  doc.setCreator("VendorBridge");
  doc.setCreationDate(generatedAt);

  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const w = new Writer(doc, fonts);

  // ------------------------------------------------------------------ header
  w.box(MARGIN, PAGE.height - MARGIN - 6, 30, 30, COLOR.brand);
  w.page.drawText("VB", {
    x: MARGIN + 6,
    y: PAGE.height - MARGIN - 1,
    size: 13,
    font: fonts.bold,
    color: COLOR.white,
  });
  w.y = PAGE.height - MARGIN - 3;
  w.text(issuer, { x: MARGIN + 42, size: 15, bold: true });
  w.y -= 16;
  w.text("Procurement & vendor operations", { x: MARGIN + 42, size: 9, color: COLOR.muted });

  w.y = PAGE.height - MARGIN - 2;
  w.text("SYSTEM-GENERATED PRO FORMA INVOICE", { size: 9, bold: true, color: COLOR.brand, align: "right", width: CONTENT_WIDTH });
  w.y -= 18;
  w.text(invoice.number, { size: 20, bold: true, align: "right", width: CONTENT_WIDTH });
  w.y -= 14;
  w.text(`Status: ${pdfText(invoice.status)}`, { size: 9, color: COLOR.muted, align: "right", width: CONTENT_WIDTH });

  w.y = PAGE.height - MARGIN - 58;
  w.rule(COLOR.head, 1.2);
  w.moveDown(18);

  // ------------------------------------------------------------- meta blocks
  const half = CONTENT_WIDTH / 2 - 16;
  const metaTop = w.y;

  w.text("SUPPLIER", { size: 8, bold: true, color: COLOR.muted });
  w.y -= 13;
  w.text(invoice.vendor?.name ?? "Vendor", { size: 11, bold: true });
  w.y -= 13;
  if (invoice.vendor?.code) {
    w.text(invoice.vendor.code, { size: 9, color: COLOR.soft });
    w.y -= 12;
  }
  if (invoice.vendor?.address) {
    w.text(invoice.vendor.address, { size: 9, color: COLOR.soft });
    w.y -= 12;
  }
  if (invoice.vendor?.city || invoice.vendor?.country) {
    w.text([invoice.vendor?.city, invoice.vendor?.country].filter(Boolean).join(", "), { size: 9, color: COLOR.soft });
    w.y -= 12;
  }
  if (invoice.vendor?.gstin) {
    w.text(`GSTIN ${invoice.vendor.gstin}`, { size: 9, color: COLOR.soft });
    w.y -= 12;
  }

  const supplierBottom = w.y;
  w.y = metaTop;
  const rightX = MARGIN + CONTENT_WIDTH / 2 + 16;

  for (const [label, value] of [
    ["INVOICE NUMBER", invoice.number],
    ["ISSUE DATE", pdfDate(invoice.issueDate)],
    ["DUE DATE", invoice.dueDate ? pdfDate(invoice.dueDate) : "On receipt"],
    ["PURCHASE ORDER", invoice.purchaseOrder?.number ?? "-"],
    ["RFQ REFERENCE", invoice.rfq?.reference ?? "-"],
    ["QUOTATION REVISION", invoice.purchaseOrder?.quotation?.revision ? `R${invoice.purchaseOrder.quotation.revision}` : "-"],
  ]) {
    w.text(label, { x: rightX, size: 8, bold: true, color: COLOR.muted });
    w.y -= 12;
    w.text(value, { x: rightX, size: 10, bold: true });
    w.y -= 14;
  }

  w.y = Math.min(supplierBottom, w.y) - 10;

  // Buyer / currency strip
  w.box(MARGIN, w.y - 30, CONTENT_WIDTH, 30, COLOR.brandSoft);
  w.y -= 10;
  w.text("BILLED TO", { x: MARGIN + 10, size: 8, bold: true, color: COLOR.muted });
  w.text("CURRENCY", { x: MARGIN + 250, size: 8, bold: true, color: COLOR.muted });
  w.y -= 12;
  w.text(`${issuer} procurement`, { x: MARGIN + 10, size: 10, bold: true });
  w.text(invoice.currency, { x: MARGIN + 250, size: 10, bold: true });
  w.y -= 30;

  // ---------------------------------------------------------------- line items
  const columns = [
    { key: "position", label: "#", x: MARGIN + 8, width: 24, align: "left" },
    { key: "description", label: "DESCRIPTION", x: MARGIN + 34, width: 200, align: "left" },
    { key: "quantity", label: "QTY", x: MARGIN + 244, width: 60, align: "right" },
    { key: "unitPrice", label: "UNIT PRICE", x: MARGIN + 314, width: 90, align: "right" },
    { key: "lineTotal", label: "LINE TOTAL", x: MARGIN + 414, width: 84, align: "right" },
  ];

  const tableHeader = () => {
    w.box(MARGIN, w.y - 8, CONTENT_WIDTH, 22, COLOR.head);
    for (const column of columns) {
      w.page.drawText(column.label, {
        x: column.x,
        y: w.y - 1,
        size: 7.5,
        font: fonts.bold,
        color: COLOR.white,
      });
    }
    w.y -= 22;
  };

  tableHeader();

  for (const line of invoice.items ?? []) {
    const descriptionLines = wrap(line.description, fonts.regular, 9, columns[1].width);
    const rowHeight = Math.max(22, descriptionLines.length * 12 + 10);
    if (w.ensure(rowHeight + 60)) tableHeader();

    const rowTop = w.y;
    const values = {
      position: String(line.position ?? ""),
      quantity: `${line.quantity} ${line.unit ?? ""}`.trim(),
      unitPrice: pdfMoney(line.unitPrice, invoice.currency),
      lineTotal: pdfMoney(line.lineTotal, invoice.currency),
    };

    w.page.drawText(pdfText(values.position), {
      x: columns[0].x,
      y: rowTop - 14,
      size: 9,
      font: fonts.regular,
      color: COLOR.soft,
    });

    descriptionLines.forEach((text, index) => {
      w.page.drawText(text, {
        x: columns[1].x,
        y: rowTop - 14 - index * 12,
        size: 9,
        font: fonts.regular,
        color: COLOR.ink,
      });
    });

    for (const key of ["quantity", "unitPrice", "lineTotal"]) {
      const column = columns.find((entry) => entry.key === key);
      const font = key === "lineTotal" ? fonts.bold : fonts.regular;
      const text = pdfText(values[key]);
      const width = font.widthOfTextAtSize(text, 9);
      w.page.drawText(text, {
        x: column.x + column.width - width,
        y: rowTop - 14,
        size: 9,
        font,
        color: COLOR.ink,
      });
    }

    w.y = rowTop - rowHeight;
    w.rule(COLOR.line, 0.6);
  }

  // -------------------------------------------------------------------- totals
  const totalsX = MARGIN + CONTENT_WIDTH - 220;
  const rows = [
    ["Subtotal", pdfMoney(invoice.subtotal, invoice.currency)],
    [`Tax (${Number(invoice.taxPercent).toFixed(2)}%)`, pdfMoney(invoice.taxAmount, invoice.currency)],
    ["Delivery", pdfMoney(invoice.shippingAmount, invoice.currency)],
  ];

  if (w.ensure(120)) tableHeader();
  w.moveDown(12);
  for (const [label, value] of rows) {
    w.text(label, { x: totalsX, size: 9, color: COLOR.soft });
    w.text(value, { x: totalsX, size: 9, align: "right", width: 220 });
    w.y -= 14;
  }

  w.y -= 2;
  w.box(totalsX - 8, w.y - 22, 236, 26, COLOR.brandSoft);
  w.y -= 6;
  w.text("TOTAL DUE", { x: totalsX, size: 8.5, bold: true, color: COLOR.brand });
  w.text(pdfMoney(invoice.total, invoice.currency), { x: totalsX, size: 13, bold: true, align: "right", width: 220 });
  w.y -= 26;

  // -------------------------------------------------------------------- notes
  w.moveDown(10);
  if (w.ensure(120)) tableHeader();

  const notes = [
    "Tax and delivery charges carry over from the approved quotation; tax is calculated once on the subtotal.",
    "This document is generated by VendorBridge from persisted approval, purchase order and invoice records.",
    "It is an internal pro forma document and does not replace a vendor-issued tax invoice.",
  ];
  for (const note of notes) {
    for (const line of wrap(note, fonts.regular, 8, CONTENT_WIDTH)) {
      w.text(line, { size: 8, color: COLOR.muted });
      w.y -= 10;
    }
  }

  // -------------------------------------------------------------------- footer
  const footerY = MARGIN - 4;
  w.page.drawLine({
    start: { x: MARGIN, y: footerY + 16 },
    end: { x: PAGE.width - MARGIN, y: footerY + 16 },
    thickness: 0.6,
    color: COLOR.line,
  });
  w.page.drawText(pdfText(`Generated ${pdfDate(generatedAt)} - ${invoice.number}`), {
    x: MARGIN,
    y: footerY,
    size: 7.5,
    font: fonts.regular,
    color: COLOR.muted,
  });
  w.page.drawText(pdfText(`Page ${w.pageNumber}`), {
    x: PAGE.width - MARGIN - 40,
    y: footerY,
    size: 7.5,
    font: fonts.regular,
    color: COLOR.muted,
  });

  return doc.save();
}
