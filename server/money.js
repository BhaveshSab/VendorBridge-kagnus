import { Prisma } from "@prisma/client";

const { Decimal } = Prisma;

export const SUPPORTED_CURRENCIES = ["INR", "USD", "AED", "EUR", "GBP", "SGD"];

// Monetary values are stored as fixed-point DECIMAL columns and are always
// rounded to two decimals (half-up) on the server before being persisted.
export const MONEY_SCALE = 2;
export const QUANTITY_SCALE = 3;

export function toDecimal(value) {
  return value instanceof Decimal ? value : new Decimal(String(value));
}

export function roundMoney(value) {
  return toDecimal(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

/** Serialise a Decimal (or numeric) as a fixed two-decimal string. */
export function moneyOut(value) {
  if (value == null) return null;
  return roundMoney(value).toFixed(MONEY_SCALE);
}

/** Serialise a quantity without trailing zeros ("12.000" → "12", "1.500" → "1.5"). */
export function quantityOut(value) {
  if (value == null) return null;
  const fixed = toDecimal(value).toFixed(QUANTITY_SCALE);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/** Percent values are stored as DECIMAL(5,2). */
export function percentOut(value) {
  if (value == null) return "0.00";
  return toDecimal(value).toFixed(2);
}

/**
 * Cost basis used for every quotation and for the comparison screen:
 *   line total = round(unit price × requested quantity, 2)
 *   subtotal   = sum(line totals)
 *   tax        = round(subtotal × tax percent / 100, 2)
 *   total      = subtotal + tax + shipping
 * All four values are derived on the server; a client can only supply unit
 * prices, a tax percentage and a shipping amount.
 */
export function computeQuotationTotals({ lines, taxPercent, shippingAmount }) {
  const subtotal = lines.reduce((sum, line) => sum.add(line.lineTotal), new Decimal(0));
  const tax = roundMoney(subtotal.times(toDecimal(taxPercent)).dividedBy(100));
  const shipping = roundMoney(shippingAmount);
  const total = roundMoney(subtotal.add(tax).add(shipping));
  return {
    subtotal: roundMoney(subtotal),
    taxAmount: tax,
    shippingAmount: shipping,
    total,
  };
}

export function lineTotalFor(unitPrice, quantity) {
  return roundMoney(toDecimal(unitPrice).times(toDecimal(quantity)));
}

export function moneyEquals(a, b) {
  return toDecimal(a).equals(toDecimal(b));
}
