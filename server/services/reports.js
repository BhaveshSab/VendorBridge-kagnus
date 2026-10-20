import { ApiError } from "../auth.js";
import { prisma } from "../db.js";

/**
 * Week 4 — reporting read models.
 *
 * Purchase orders can be priced in different currencies, so spend is never
 * summed across them. The dominant currency of the selected period is reported
 * in detail, and every currency bucket is returned so the UI can be honest
 * about what it excluded.
 */

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function monthKey(date) {
  return date.toISOString().slice(0, 7);
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function parseDay(value, field) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    throw new ApiError(422, "Please check the date range and try again.", {
      code: "validation_failed",
      fields: { [field]: "Use a date in YYYY-MM-DD format." },
    });
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new ApiError(422, "Please check the date range and try again.", {
      code: "validation_failed",
      fields: { [field]: "That is not a valid calendar date." },
    });
  }
  return date;
}

/**
 * Resolve `from`/`to` query values into a half-open UTC interval. Defaults to
 * the last 90 days, refuses an inverted or overly long window, and returns the
 * inclusive dates for display and export filenames.
 */
export function resolveRange(query = {}) {
  const now = new Date();
  const endOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

  const toInclusive = query.to ? parseDay(query.to, "to") : null;
  const to = toInclusive ? new Date(toInclusive.getTime() + DAY_MS) : endOfToday;
  const from = query.from ? parseDay(query.from, "from") : new Date(to.getTime() - 90 * DAY_MS);

  if (from.getTime() >= to.getTime()) {
    throw new ApiError(422, "The start date must be before the end date.", {
      code: "validation_failed",
      fields: { from: "Start date must be before the end date." },
    });
  }

  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  if (days > MAX_RANGE_DAYS) {
    throw new ApiError(422, `Reports cover at most ${MAX_RANGE_DAYS} days at a time.`, {
      code: "validation_failed",
      fields: { from: `Choose a range of ${MAX_RANGE_DAYS} days or fewer.` },
    });
  }

  return {
    from,
    to,
    days,
    fromDate: ymd(from),
    toDate: ymd(new Date(to.getTime() - DAY_MS)),
    label: `${ymd(from)} → ${ymd(new Date(to.getTime() - DAY_MS))}`,
  };
}

function rangeQuery(range) {
  return { gte: range.from, lt: range.to };
}

/** Months touched by the range, oldest first, so empty months still render. */
function monthBuckets(range) {
  const buckets = [];
  const cursor = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), 1));
  while (cursor.getTime() < range.to.getTime()) {
    buckets.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return buckets;
}

async function issuedOrders(range) {
  return prisma.purchaseOrder.findMany({
    where: { status: "issued", issuedAt: rangeQuery(range) },
    orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
    take: 20_000,
    select: {
      id: true,
      number: true,
      currency: true,
      total: true,
      issuedAt: true,
      vendorId: true,
      approvalRequest: { select: { requestedAt: true } },
      vendor: { select: { id: true, name: true, code: true, category: true } },
    },
  });
}

function pickCurrency(orders) {
  const buckets = new Map();
  for (const order of orders) {
    const bucket = buckets.get(order.currency) || { currency: order.currency, orders: 0, total: 0 };
    bucket.orders += 1;
    bucket.total += Number(order.total);
    buckets.set(order.currency, bucket);
  }
  const list = [...buckets.values()]
    .map((bucket) => ({ ...bucket, total: money(bucket.total) }))
    .sort((a, b) => Number(b.total) - Number(a.total) || b.orders - a.orders);
  return { list, currency: list[0]?.currency || "INR" };
}

export async function buildOverview(range) {
  const [
    orders,
    invoices,
    approvalGroups,
    decisions,
    rfqCreated,
    openRfqs,
    quotations,
    vendorTotal,
    newVendors,
  ] = await Promise.all([
    issuedOrders(range),
    prisma.invoice.findMany({
      where: { issueDate: rangeQuery(range) },
      select: { id: true, number: true, currency: true, total: true, status: true, dueDate: true },
      take: 20_000,
    }),
    prisma.approvalRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.approvalRequest.findMany({
      where: { decidedAt: rangeQuery(range), status: { in: ["approved", "rejected"] } },
      select: { status: true, requestedAt: true, decidedAt: true },
      take: 20_000,
    }),
    prisma.rfq.count({ where: { createdAt: rangeQuery(range) } }),
    prisma.rfq.count({ where: { status: "open", deadline: { gt: new Date() } } }),
    prisma.quotation.count({ where: { submittedAt: rangeQuery(range) } }),
    prisma.vendor.count(),
    prisma.vendor.count({ where: { createdAt: rangeQuery(range) } }),
  ]);

  const { list: currencies, currency } = pickCurrency(orders);
  const scoped = orders.filter((order) => order.currency === currency);
  const scopedTotal = scoped.reduce((sum, order) => sum + Number(order.total), 0);

  // Spend by month, including months with no orders so the trend chart is even.
  const monthMap = new Map(
    monthBuckets(range).map((key) => [key, { month: key, label: monthLabel(key), currency, total: 0, orders: 0 }]),
  );
  for (const order of scoped) {
    const bucket = monthMap.get(monthKey(order.issuedAt));
    if (!bucket) continue;
    bucket.total += Number(order.total);
    bucket.orders += 1;
  }
  const spendByMonth = [...monthMap.values()].map((bucket) => ({ ...bucket, total: money(bucket.total) }));

  const categoryMap = new Map();
  for (const order of scoped) {
    const name = order.vendor?.category || "Uncategorised";
    const bucket = categoryMap.get(name) || { name, currency, total: 0, orders: 0 };
    bucket.total += Number(order.total);
    bucket.orders += 1;
    categoryMap.set(name, bucket);
  }
  const spendByCategory = [...categoryMap.values()]
    .map((bucket) => ({
      ...bucket,
      total: money(bucket.total),
      share: scopedTotal > 0 ? Math.round((bucket.total / scopedTotal) * 1000) / 10 : 0,
    }))
    .sort((a, b) => Number(b.total) - Number(a.total));

  const vendorMap = new Map();
  for (const order of scoped) {
    const bucket = vendorMap.get(order.vendorId) || {
      id: order.vendorId,
      name: order.vendor?.name || "Unknown supplier",
      code: order.vendor?.code || null,
      category: order.vendor?.category || null,
      currency,
      total: 0,
      orders: 0,
    };
    bucket.total += Number(order.total);
    bucket.orders += 1;
    vendorMap.set(order.vendorId, bucket);
  }
  const topVendors = [...vendorMap.values()]
    .map((bucket) => ({
      ...bucket,
      total: money(bucket.total),
      share: scopedTotal > 0 ? Math.round((bucket.total / scopedTotal) * 1000) / 10 : 0,
    }))
    .sort((a, b) => Number(b.total) - Number(a.total))
    .slice(0, 8);

  const approvalCounts = { pending: 0, approved: 0, rejected: 0 };
  for (const row of approvalGroups) {
    if (Object.hasOwn(approvalCounts, row.status)) approvalCounts[row.status] = row._count._all;
  }

  const turnaroundHours = decisions
    .map((row) => (row.decidedAt.getTime() - row.requestedAt.getTime()) / 3_600_000)
    .filter((hours) => Number.isFinite(hours) && hours >= 0);
  const avgApprovalHours =
    turnaroundHours.length > 0
      ? Math.round((turnaroundHours.reduce((sum, hours) => sum + hours, 0) / turnaroundHours.length) * 10) / 10
      : null;

  const cycleDays = scoped
    .map((order) => {
      const requestedAt = order.approvalRequest?.requestedAt;
      if (!requestedAt) return null;
      return (order.issuedAt.getTime() - requestedAt.getTime()) / DAY_MS;
    })
    .filter((days) => days !== null && Number.isFinite(days) && days >= 0);
  const avgOrderDays =
    cycleDays.length > 0 ? Math.round((cycleDays.reduce((sum, days) => sum + days, 0) / cycleDays.length) * 10) / 10 : null;

  const scopedInvoices = invoices.filter((invoice) => invoice.currency === currency);
  // Overdue is scoped to the invoices issued in this period, so the number on
  // the card always reconciles with the invoice count beside it.
  const overdueInvoices = scopedInvoices.filter(
    (invoice) => invoice.status === "issued" && invoice.dueDate && invoice.dueDate.getTime() < Date.now(),
  ).length;

  return {
    range: { from: range.fromDate, to: range.toDate, days: range.days },
    currency,
    currencies,
    totals: {
      purchaseOrders: scoped.length,
      purchaseOrderValue: money(scopedTotal),
      allPurchaseOrders: orders.length,
      invoices: scopedInvoices.length,
      invoiceValue: money(scopedInvoices.reduce((sum, invoice) => sum + Number(invoice.total), 0)),
      overdueInvoices,
      quotes: quotations,
      rfqsCreated: rfqCreated,
      openRfqs,
      pendingApprovals: approvalCounts.pending,
      approvedApprovals: approvalCounts.approved,
      rejectedApprovals: approvalCounts.rejected,
      decidedInRange: decisions.length,
      avgApprovalHours,
      avgOrderDays,
      activeVendors: await prisma.vendor.count({ where: { status: "Active" } }),
      totalVendors: vendorTotal,
      newVendors,
    },
    spendByMonth,
    spendByCategory,
    topVendors,
  };
}

export async function buildVendorPerformance(range) {
  const orders = await issuedOrders(range);
  const { currency } = pickCurrency(orders);
  const scoped = orders.filter((order) => order.currency === currency);
  const scopedTotal = scoped.reduce((sum, order) => sum + Number(order.total), 0);

  const [quotationRows, assignmentRows] = await Promise.all([
    prisma.quotation.groupBy({
      by: ["vendorId"],
      where: { submittedAt: rangeQuery(range) },
      _count: { _all: true },
      _avg: { deliveryDays: true },
    }),
    prisma.rfqAssignment.groupBy({
      by: ["vendorId"],
      where: { rfq: { createdAt: rangeQuery(range) } },
      _count: { _all: true },
    }),
  ]);

  const spend = new Map();
  for (const order of scoped) {
    const bucket = spend.get(order.vendorId) || { total: 0, orders: 0 };
    bucket.total += Number(order.total);
    bucket.orders += 1;
    spend.set(order.vendorId, bucket);
  }

  const quotes = new Map(
    quotationRows.map((row) => [
      row.vendorId,
      { count: row._count._all, avgDeliveryDays: row._avg.deliveryDays == null ? null : Math.round(row._avg.deliveryDays * 10) / 10 },
    ]),
  );
  const invited = new Map(assignmentRows.map((row) => [row.vendorId, row._count._all]));

  const ids = new Set([...spend.keys(), ...quotes.keys(), ...invited.keys()]);
  if (ids.size === 0) {
    return { range: { from: range.fromDate, to: range.toDate, days: range.days }, currency, rows: [] };
  }

  const vendors = await prisma.vendor.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, code: true, category: true, status: true, rating: true },
  });

  const rows = vendors
    .map((vendor) => {
      const awarded = spend.get(vendor.id)?.orders ?? 0;
      const quoted = quotes.get(vendor.id)?.count ?? 0;
      const total = spend.get(vendor.id)?.total ?? 0;
      return {
        vendorId: vendor.id,
        name: vendor.name,
        code: vendor.code,
        category: vendor.category,
        status: vendor.status,
        rating: vendor.rating,
        invited: invited.get(vendor.id) ?? 0,
        quoted,
        awarded,
        winRate: quoted > 0 ? Math.round((awarded / quoted) * 1000) / 10 : null,
        avgDeliveryDays: quotes.get(vendor.id)?.avgDeliveryDays ?? null,
        currency,
        spend: money(total),
        share: scopedTotal > 0 ? Math.round((total / scopedTotal) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => Number(b.spend) - Number(a.spend) || b.quoted - a.quoted || a.name.localeCompare(b.name));

  return { range: { from: range.fromDate, to: range.toDate, days: range.days }, currency, rows };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function csvCell(value) {
  let text = value == null ? "" : String(value);
  // Formula injection guard: a spreadsheet must not execute a vendor name or a
  // note that starts with = + - @.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return `\ufeff${lines.join("\r\n")}\r\n`;
}

export const EXPORT_TYPES = ["spend", "purchase-orders", "invoices"];

export async function buildCsv(type, range) {
  if (type === "spend") {
    const { rows, currency } = await buildVendorPerformance(range);
    return {
      type,
      filename: `vendorbridge-spend-${range.toDate}.csv`,
      csv: toCsv(
        ["Vendor", "Code", "Category", "Status", "Currency", "Awarded orders", "Spend", "Share %", "Quotations", "Win rate %"],
        rows.map((row) => [
          row.name,
          row.code,
          row.category,
          row.status,
          row.currency,
          row.awarded,
          row.spend,
          row.share,
          row.quoted,
          row.winRate ?? "",
        ]),
      ),
      currency,
    };
  }

  if (type === "purchase-orders") {
    const orders = await prisma.purchaseOrder.findMany({
      where: { issuedAt: rangeQuery(range) },
      orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
      take: 20_000,
      select: {
        number: true,
        status: true,
        currency: true,
        subtotal: true,
        taxAmount: true,
        shippingAmount: true,
        total: true,
        issuedAt: true,
        cancelledAt: true,
        vendor: { select: { name: true, code: true, category: true } },
        rfq: { select: { reference: true, title: true } },
      },
    });
    return {
      type,
      filename: `vendorbridge-purchase-orders-${range.toDate}.csv`,
      csv: toCsv(
        ["PO number", "Status", "Issued", "Vendor", "Vendor code", "Category", "RFQ", "RFQ title", "Currency", "Subtotal", "Tax", "Shipping", "Total", "Cancelled"],
        orders.map((order) => [
          order.number,
          order.status,
          ymd(order.issuedAt),
          order.vendor?.name,
          order.vendor?.code,
          order.vendor?.category,
          order.rfq?.reference,
          order.rfq?.title,
          order.currency,
          money(order.subtotal),
          money(order.taxAmount),
          money(order.shippingAmount),
          money(order.total),
          order.cancelledAt ? ymd(order.cancelledAt) : "",
        ]),
      ),
    };
  }

  const invoices = await prisma.invoice.findMany({
    where: { issueDate: rangeQuery(range) },
    orderBy: [{ issueDate: "asc" }, { id: "asc" }],
    take: 20_000,
    select: {
      number: true,
      status: true,
      currency: true,
      subtotal: true,
      taxAmount: true,
      total: true,
      issueDate: true,
      dueDate: true,
      emailStatus: true,
      vendor: { select: { name: true, code: true } },
      purchaseOrder: { select: { number: true } },
    },
  });

  return {
    type,
    filename: `vendorbridge-invoices-${range.toDate}.csv`,
    csv: toCsv(
      ["Invoice number", "Status", "Issued", "Due", "Vendor", "Vendor code", "Purchase order", "Currency", "Subtotal", "Tax", "Total", "Email status"],
      invoices.map((invoice) => [
        invoice.number,
        invoice.status,
        ymd(invoice.issueDate),
        invoice.dueDate ? ymd(invoice.dueDate) : "",
        invoice.vendor?.name,
        invoice.vendor?.code,
        invoice.purchaseOrder?.number,
        invoice.currency,
        money(invoice.subtotal),
        money(invoice.taxAmount),
        money(invoice.total),
        invoice.emailStatus,
      ]),
    ),
  };
}
