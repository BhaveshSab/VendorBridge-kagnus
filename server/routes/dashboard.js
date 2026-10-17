import { Router } from "express";
import { currentVendorFor, requireAuth } from "../auth.js";
import { prisma } from "../db.js";
import { vendorOut } from "../serializers.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const [statusRows, categoryRows, totalVendors] = await Promise.all([
    prisma.vendor.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.vendor.groupBy({ by: ["category"], _count: { _all: true } }),
    prisma.vendor.count(),
  ]);

  const statusCounts = Object.fromEntries(statusRows.map((row) => [row.status, row._count._all]));
  const categoryCounts = categoryRows
    .map((row) => ({ name: row.category, count: row._count._all }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  if (req.user.role === "vendor") {
    const vendor = await currentVendorFor(req.user);
    res.json({
      scope: "vendor",
      hasVendorProfile: Boolean(vendor),
      vendor: vendorOut(vendor),
      statusCounts,
      categoryCounts,
      totalVendors,
    });
    return;
  }

  const recentVendors = await prisma.vendor.findMany({ orderBy: { updatedAt: "desc" }, take: 5 });
  res.json({
    scope: "internal",
    statusCounts,
    categoryCounts,
    totalVendors,
    recentVendors: recentVendors.map(vendorOut),
  });
});

export default router;
