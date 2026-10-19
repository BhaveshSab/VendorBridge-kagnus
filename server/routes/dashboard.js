import { Router } from "express";
import { currentVendorFor, requireAuth, requireRole } from "../auth.js";
import { prisma } from "../db.js";
import { vendorOut } from "../serializers.js";

const router = Router();
router.use(requireAuth, requireRole("admin", "procurement", "manager", "vendor"));

router.get("/", async (req, res) => {
  const at = new Date();

  if (req.user.role === "vendor") {
    // Vendors may see their own status/category only, never company-wide totals.
    const vendor = await currentVendorFor(req.user);
    const [assignedRfqs, openRfqs, submittedQuotations] = vendor
      ? await Promise.all([
          prisma.rfqAssignment.count({
            where: { vendorId: vendor.id, rfq: { status: { not: "draft" } } },
          }),
          prisma.rfqAssignment.count({
            where: { vendorId: vendor.id, rfq: { status: "open", deadline: { gt: at } } },
          }),
          prisma.quotation.count({ where: { vendorId: vendor.id } }),
        ])
      : [0, 0, 0];

    res.json({
      scope: "vendor",
      hasVendorProfile: Boolean(vendor),
      vendor: vendorOut(vendor, { includeInternalNotes: false }),
      statusCounts: vendor ? { [vendor.status]: 1 } : {},
      categoryCounts: vendor ? [{ name: vendor.category, count: 1 }] : [],
      totalVendors: vendor ? 1 : 0,
      rfqSummary: {
        assigned: assignedRfqs,
        open: openRfqs,
        submitted: submittedQuotations,
      },
    });
    return;
  }

  const [statusRows, categoryRows, totalVendors, recentVendors, rfqRows, quotationCount, openRfqs] =
    await Promise.all([
      prisma.vendor.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.vendor.groupBy({ by: ["category"], _count: { _all: true } }),
      prisma.vendor.count(),
      prisma.vendor.findMany({ orderBy: { updatedAt: "desc" }, take: 5 }),
      prisma.rfq.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.quotation.count(),
      prisma.rfq.count({ where: { status: "open", deadline: { gt: at } } }),
    ]);

  const statusCounts = Object.fromEntries(statusRows.map((row) => [row.status, row._count._all]));
  const categoryCounts = categoryRows
    .map((row) => ({ name: row.category, count: row._count._all }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const rfqCounts = Object.fromEntries(rfqRows.map((row) => [row.status, row._count._all]));
  const openCount = rfqCounts.open ?? 0;

  res.json({
    scope: "internal",
    statusCounts,
    categoryCounts,
    totalVendors,
    recentVendors: recentVendors.map(vendorOut),
    rfqSummary: {
      total: rfqRows.reduce((sum, row) => sum + row._count._all, 0),
      open: openRfqs,
      expired: openCount - openRfqs,
      draft: rfqCounts.draft ?? 0,
      closed: rfqCounts.closed ?? 0,
      cancelled: rfqCounts.cancelled ?? 0,
      quotations: quotationCount,
    },
  });
});

export default router;
