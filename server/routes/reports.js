import { Router } from "express";
import { ApiError, requireAuth, requireRole } from "../auth.js";
import {
  EXPORT_TYPES,
  buildCsv,
  buildOverview,
  buildVendorPerformance,
  resolveRange,
} from "../services/reports.js";

const router = Router();

// Spend analytics and exports are internal: vendors only ever see their own
// documents through the PO and invoice endpoints.
router.use(requireAuth, requireRole("admin", "procurement", "manager"));

router.get("/overview", async (req, res) => {
  const range = resolveRange(req.query);
  res.json(await buildOverview(range));
});

router.get("/vendors", async (req, res) => {
  const range = resolveRange(req.query);
  res.json(await buildVendorPerformance(range));
});

router.get("/export", async (req, res) => {
  const type = String(req.query.type || "spend");
  if (!EXPORT_TYPES.includes(type)) {
    throw new ApiError(422, "Choose a report to export.", {
      code: "validation_failed",
      fields: { type: `Supported exports: ${EXPORT_TYPES.join(", ")}.` },
    });
  }

  const range = resolveRange(req.query);
  const { filename, csv } = await buildCsv(type, range);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});

export default router;
