import { Prisma } from "@prisma/client";
import { computeQuotationTotals, moneyEquals, moneyOut, percentOut, quantityOut, roundMoney, toDecimal } from "./money.js";

/**
 * Week 3 workflow helpers.
 *
 * Everything money-related on an approval, purchase order or invoice is derived
 * from persisted quotation rows. The snapshot stored on an approval request is
 * the immutable record of what a manager actually reviewed; the PO and invoice
 * are generated from that snapshot and re-validated against the live rows so an
 * approved set of terms can never silently change.
 */

// Only these tables are locked, so the identifier below can never be injected.
const LOCKABLE_TABLES = new Set(["quotations", "approval_requests", "purchase_orders"]);

/**
 * `SELECT ... FOR UPDATE` on a single row inside `tx`. Serialising on the
 * quotation / approval / purchase-order row is what makes "exactly one
 * decision" and "exactly one document" true under concurrent requests.
 */
export async function lockRow(tx, table, id) {
  if (!LOCKABLE_TABLES.has(table)) throw new Error(`Refusing to lock table ${table}`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id = ${id} FOR UPDATE`);
}

export function numberOut(value) {
  return value == null ? null : toDecimal(value).toFixed(0);
}

/** Friendly, immutable copy of a vendor's submitted quotation terms. */
export function buildQuotationSnapshot(quotation, rfq) {
  const itemsById = new Map(rfq.items.map((item) => [item.id, item]));
  const lines = [...quotation.items]
    .sort((a, b) => (itemsById.get(a.rfqItemId)?.position ?? 0) - (itemsById.get(b.rfqItemId)?.position ?? 0))
    .map((line) => {
      const item = itemsById.get(line.rfqItemId);
      return {
        position: item?.position ?? 0,
        rfqItemId: line.rfqItemId,
        description: item?.description ?? `Item #${line.rfqItemId}`,
        quantity: quantityOut(item?.quantity ?? 0),
        unit: item?.unit ?? "unit",
        unitPrice: moneyOut(line.unitPrice),
        lineTotal: moneyOut(line.lineTotal),
      };
    });

  return {
    version: 1,
    quotationId: quotation.id,
    quotationRevision: quotation.revision,
    quotationUpdatedAt: quotation.updatedAt.toISOString(),
    rfqId: rfq.id,
    rfqReference: rfq.reference,
    rfqTitle: rfq.title,
    vendorId: quotation.vendorId,
    vendorName: quotation.vendor?.name ?? null,
    vendorCode: quotation.vendor?.code ?? null,
    currency: quotation.currency,
    deliveryDays: quotation.deliveryDays,
    deliveryTerms: quotation.deliveryTerms ?? null,
    taxPercent: percentOut(quotation.taxPercent),
    subtotal: moneyOut(quotation.subtotal),
    taxAmount: moneyOut(quotation.taxAmount),
    shippingAmount: moneyOut(quotation.shippingAmount),
    total: moneyOut(quotation.total),
    items: lines,
  };
}

/**
 * Re-derives every total from the stored unit prices and the RFQ quantities.
 * Any disagreement means the row was edited outside the API; approval, PO and
 * invoice generation all refuse to proceed in that case.
 */
export function quotationIssues(quotation, rfq) {
  const issues = [];
  const itemsById = new Map(rfq.items.map((item) => [item.id, item]));

  if (quotation.currency !== rfq.currency) {
    issues.push(`Quoted in ${quotation.currency} but the RFQ is priced in ${rfq.currency}.`);
  }

  const lines = [];
  for (const item of rfq.items) {
    const line = quotation.items.find((entry) => entry.rfqItemId === item.id);
    if (!line) {
      issues.push(`Requested item "${item.description}" is not priced.`);
      continue;
    }
    const expected = roundMoney(toDecimal(line.unitPrice).times(toDecimal(item.quantity)));
    if (!expected.equals(line.lineTotal)) {
      issues.push(`Line total for "${item.description}" does not match quantity x unit price.`);
    }
    lines.push({ rfqItemId: item.id, unitPrice: line.unitPrice, lineTotal: expected });
  }

  const stray = quotation.items.filter((line) => !itemsById.has(line.rfqItemId));
  if (stray.length > 0) issues.push("The quotation prices items that are not part of this RFQ.");

  const totals = computeQuotationTotals({
    lines,
    taxPercent: quotation.taxPercent,
    shippingAmount: quotation.shippingAmount,
  });
  if (!totals.subtotal.equals(quotation.subtotal)) issues.push("Stored subtotal is not the sum of the line totals.");
  if (!totals.taxAmount.equals(quotation.taxAmount)) issues.push("Stored tax does not match the tax percentage.");
  if (!totals.shippingAmount.equals(quotation.shippingAmount)) issues.push("Stored delivery charge is inconsistent.");
  if (!totals.total.equals(quotation.total)) issues.push("Stored total does not match the server-side calculation.");

  return issues;
}

/** Compares the reviewed snapshot with the quotation rows as they are now. */
export function snapshotIssues(snapshot, quotation, rfq) {
  const issues = [];
  if (!snapshot || typeof snapshot !== "object") return ["The approval snapshot is missing."];

  if (snapshot.quotationRevision !== quotation.revision) {
    issues.push(
      `The quotation was revised after it was submitted for approval (revision ${quotation.revision}, reviewed ${snapshot.quotationRevision}).`,
    );
  }
  if (snapshot.quotationId !== quotation.id) issues.push("The approval refers to a different quotation.");
  if (snapshot.currency !== quotation.currency) issues.push("The quotation currency changed after review.");

  for (const [key, label] of [
    ["subtotal", "subtotal"],
    ["taxAmount", "tax"],
    ["shippingAmount", "delivery charge"],
    ["total", "total"],
  ]) {
    if (!moneyEquals(snapshot[key], quotation[key])) {
      issues.push(`The quotation ${label} changed after review.`);
    }
  }

  const snapshotItems = Array.isArray(snapshot.items) ? snapshot.items : [];
  if (snapshotItems.length !== quotation.items.length) {
    issues.push("The quotation line items changed after review.");
  } else {
    const byItem = new Map(snapshotItems.map((line) => [line.rfqItemId, line]));
    for (const line of quotation.items) {
      const reviewed = byItem.get(line.rfqItemId);
      if (!reviewed) {
        issues.push("The quotation line items changed after review.");
        break;
      }
      if (!moneyEquals(reviewed.unitPrice, line.unitPrice)) {
        issues.push("A quoted unit price changed after review.");
        break;
      }
    }
  }

  if (rfq && rfq.currency !== quotation.currency) {
    issues.push("The quotation is no longer in the RFQ currency.");
  }

  return issues;
}

/**
 * Verifies the stored document totals against its own line items so a tampered
 * row can never be copied into the next document in the chain.
 */
export function documentIssues({ items, taxPercent, subtotal, taxAmount, shippingAmount, total, currency, rfqCurrency }) {
  const issues = [];
  if (currency && rfqCurrency && currency !== rfqCurrency) issues.push("Document currency differs from the RFQ currency.");

  const subtotalFromLines = items.reduce((sum, line) => sum.add(toDecimal(line.lineTotal)), toDecimal(0));
  if (!moneyEquals(subtotalFromLines, subtotal)) issues.push("Line totals do not add up to the stored subtotal.");

  const expectedTax = roundMoney(toDecimal(subtotal).times(toDecimal(taxPercent)).dividedBy(100));
  if (!moneyEquals(expectedTax, taxAmount)) issues.push("Stored tax does not match the tax rate.");

  const expectedTotal = roundMoney(toDecimal(subtotal).add(toDecimal(taxAmount)).add(toDecimal(shippingAmount)));
  if (!moneyEquals(expectedTotal, total)) issues.push("Subtotal, tax and delivery do not add up to the stored total.");

  for (const line of items) {
    const expected = roundMoney(toDecimal(line.unitPrice).times(toDecimal(line.quantity)));
    if (!moneyEquals(expected, line.lineTotal)) {
      issues.push(`Line "${line.description}" does not match quantity x unit price.`);
      break;
    }
  }

  return issues;
}

/** First N characters of a provider error, with API keys redacted. */
export function safeErrorText(error) {
  const text = String(error?.message || error || "Delivery failed.")
    .replace(/re_[A-Za-z0-9]{8,}/g, "re_[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  return text.slice(0, 240);
}

export function documentNumber(prefix, sequence) {
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}
