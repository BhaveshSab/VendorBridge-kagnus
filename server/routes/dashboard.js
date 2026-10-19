import { Router } from "express";
import { currentVendorFor, requireAuth, requireRole } from "../auth.js";
import { prisma } from "../db.js";
import { vendorOut } from "../serializers.js";

const router = Router();
router.use(requireAuth, requireRole("admin", "procurement", "manager", "vendor"));

router.get("/", async (req, res) => {
  if (req.user.role === "vendor") {
    // Vendors may see their own status/category only, never company-wide totals.
    const vendor = await currentVendorFor(req.user);
    res.json({
      scope: "vendor",
      hasVendorProfile: Boolean(vendor),
      vendor: vendorOut(vendor, { includeInternalNotes: false }),
      statusCounts: vendor ? { [vendor.status]: 1 } : {},
      categoryCounts: vendor ? [{ name: vendor.category, count: 1 }] : [],
      totalVendors: vendor ? 1 : 0,
    });
    return;
  }

  const [statusRows, categoryRows, totalVendors, recentVendors] = await Promise.all([
    prisma.vendor.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.vendor.groupBy({ by: ["category"], _count: { _all: true } }),
    prisma.vendor.count(),
    prisma.vendor.findMany({ orderBy: { updatedAt: "desc" }, take: 5 }),
  ]);

  const statusCounts = Object.fromEntries(statusRows.map((row) => [row.status, row._count._all]));
  const categoryCounts = categoryRows
    .map((row) => ({ name: row.category, count: row._count._all }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  res.json({
    scope: "internal",
    statusCounts,
    categoryCounts,
    totalVendors,
    recentVendors: recentVendors.map(vendorOut),
  });
});

export default router;
