import { Router } from "express";
import { currentVendorFor, requireAuth, requireRole } from "../auth.js";
import { cachedJson } from "../cache.js";
import { prisma } from "../db.js";
import { vendorOut } from "../serializers.js";

const router = Router();
router.use(requireAuth, requireRole("admin", "procurement", "manager", "vendor"));

// The dashboard is a summary read model: identical for every staff role, and a
// few seconds of staleness is invisible next to the cost of seven aggregate
// queries over a high-latency database. Writes to vendors and RFQs bump the
// namespace, so the next request after a change misses and recomputes.
const CACHE_NAMESPACE = "dashboard";
const CACHE_TTL_SECONDS = 20;

/**
 * Purchase orders can be priced in different currencies, so their value is
 * grouped instead of summed into one meaningless number. The card shows the
 * largest bucket and states how many orders and currencies there are.
 */
function documentSummary(orderRows, invoiceCount) {
  const byCurrency = orderRows.map((row) => ({
    currency: row.currency,
    total: row._sum.total ? row._sum.total.toFixed(2) : "0.00",
    count: row._count._all,
  }));
  return {
    purchaseOrders: byCurrency.reduce((sum, bucket) => sum + bucket.count, 0),
    invoices: invoiceCount,
    byCurrency: byCurrency.sort((a, b) => Number(b.total) - Number(a.total)),
  };
}

router.get("/", async (req, res) => {
  const at = new Date();

  if (req.user.role === "vendor") {
    // Vendors may see their own status/category only, never company-wide totals.
    // The scope is resolved per request so one vendor can never read another
    // vendor's cached payload — the vendor id is part of the cache key.
    const vendor = await currentVendorFor(req.user);

    if (!vendor) {
      res.json({
        scope: "vendor",
        hasVendorProfile: false,
        vendor: null,
        statusCounts: {},
        categoryCounts: [],
        totalVendors: 0,
        rfqSummary: { assigned: 0, open: 0, submitted: 0 },
      });
      return;
    }

    const payload = await cachedJson(
      CACHE_NAMESPACE,
      `vendor:${vendor.id}`,
      CACHE_TTL_SECONDS,
      async () => {
        const [assignedRfqs, openRfqs, submittedQuotations, orderRows, invoiceCount] = await Promise.all([
          prisma.rfqAssignment.count({
            where: { vendorId: vendor.id, rfq: { status: { not: "draft" } } },
          }),
          prisma.rfqAssignment.count({
            where: { vendorId: vendor.id, rfq: { status: "open", deadline: { gt: at } } },
          }),
          prisma.quotation.count({ where: { vendorId: vendor.id, supersededAt: null } }),
          // A vendor sees the value of its own issued purchase orders only.
          prisma.purchaseOrder.groupBy({
            by: ["currency"],
            where: { vendorId: vendor.id, status: "issued" },
            _count: { _all: true },
            _sum: { total: true },
          }),
          prisma.invoice.count({ where: { vendorId: vendor.id } }),
        ]);

        return {
          scope: "vendor",
          hasVendorProfile: true,
          vendor: vendorOut(vendor, { includeInternalNotes: false }),
          statusCounts: { [vendor.status]: 1 },
          categoryCounts: [{ name: vendor.category, count: 1 }],
          totalVendors: 1,
          // Approval decisions are internal review; vendors never see that queue.
          approvalSummary: null,
          documentSummary: documentSummary(orderRows, invoiceCount),
          rfqSummary: {
            assigned: assignedRfqs,
            open: openRfqs,
            submitted: submittedQuotations,
          },
        };
      },
    );

    res.json(payload);
    return;
  }

  const payload = await cachedJson(CACHE_NAMESPACE, "internal", CACHE_TTL_SECONDS, async () => {
    const [
      statusRows,
      categoryRows,
      totalVendors,
      recentVendors,
      rfqRows,
      quotationCount,
      openRfqs,
      approvalRows,
      orderRows,
      invoiceCount,
    ] = await Promise.all([
      prisma.vendor.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.vendor.groupBy({ by: ["category"], _count: { _all: true } }),
      prisma.vendor.count(),
      prisma.vendor.findMany({ orderBy: { updatedAt: "desc" }, take: 5 }),
      prisma.rfq.groupBy({ by: ["status"], _count: { _all: true } }),
      // Superseded revisions stay in the audit trail but are not live bids.
      prisma.quotation.count({ where: { supersededAt: null } }),
      prisma.rfq.count({ where: { status: "open", deadline: { gt: at } } }),
      prisma.approvalRequest.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.purchaseOrder.groupBy({
        by: ["currency"],
        where: { status: "issued" },
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.invoice.count(),
    ]);

    const approvalSummary = { pending: 0, approved: 0, rejected: 0 };
    for (const row of approvalRows) {
      if (Object.hasOwn(approvalSummary, row.status)) approvalSummary[row.status] = row._count._all;
    }

    const statusCounts = Object.fromEntries(statusRows.map((row) => [row.status, row._count._all]));
    const categoryCounts = categoryRows
      .map((row) => ({ name: row.category, count: row._count._all }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const rfqCounts = Object.fromEntries(rfqRows.map((row) => [row.status, row._count._all]));
    const openCount = rfqCounts.open ?? 0;

    return {
      scope: "internal",
      statusCounts,
      categoryCounts,
      totalVendors,
      recentVendors: recentVendors.map(vendorOut),
      approvalSummary,
      documentSummary: documentSummary(orderRows, invoiceCount),
      rfqSummary: {
        total: rfqRows.reduce((sum, row) => sum + row._count._all, 0),
        open: openRfqs,
        expired: openCount - openRfqs,
        draft: rfqCounts.draft ?? 0,
        closed: rfqCounts.closed ?? 0,
        cancelled: rfqCounts.cancelled ?? 0,
        quotations: quotationCount,
      },
    };
  });

  res.json(payload);
});

export default router;
