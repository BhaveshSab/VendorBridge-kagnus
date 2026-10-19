import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiError, currentVendorFor, parse, requireAuth, requireRole } from "../auth.js";
import { nextSequence, now, prisma } from "../db.js";
import { vendorOut } from "../serializers.js";

const router = Router();
router.use(requireAuth, requireRole("admin", "procurement", "manager", "vendor"));

const VENDOR_STATUSES = ["Active", "Pending", "Inactive", "Blocked"];

const vendorSchema = z.object({
  name: z.string().trim().min(2, "Vendor name is required.").max(120),
  category: z.string().trim().min(2, "Choose a category.").max(80),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-Z]{15}$/, "GSTIN must be 15 letters/digits.")
    .optional()
    .or(z.literal("")),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  phone: z.string().trim().min(7, "Enter a phone number.").max(24),
  address: z.string().trim().max(240).optional().default(""),
  city: z.string().trim().max(80).optional().default(""),
  country: z.string().trim().max(80).optional().default("India"),
  contactName: z.string().trim().max(120).optional().default(""),
  status: z.enum(VENDOR_STATUSES).default("Pending"),
  rating: z.coerce.number().min(0, "Rating cannot be negative.").max(5, "Rating must be 5 or below.").default(0),
  notes: z.string().trim().max(600).optional().default(""),
});

const ORDER_BY = {
  name: [{ name: "asc" }],
  created: [{ createdAt: "desc" }],
  rating: [{ rating: "desc" }, { name: "asc" }],
  status: [{ status: "asc" }, { name: "asc" }],
  updated: [{ updatedAt: "desc" }],
};

function vendorData(data, extra = {}) {
  return {
    name: data.name,
    category: data.category,
    gstin: data.gstin || null,
    email: data.email,
    phone: data.phone,
    address: data.address || null,
    city: data.city || null,
    country: data.country || "India",
    contactName: data.contactName || null,
    status: data.status,
    rating: data.rating,
    notes: data.notes || null,
    ...extra,
  };
}

router.get("/meta", requireRole("admin", "procurement", "manager"), async (_req, res) => {
  const [categories, total] = await Promise.all([
    prisma.vendor.groupBy({ by: ["category"], _count: { _all: true } }),
    prisma.vendor.count(),
  ]);
  res.json({
    categories: categories
      .map((row) => ({ name: row.category, count: row._count._all }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    statuses: VENDOR_STATUSES,
    total,
  });
});

router.get("/", async (req, res) => {
  if (req.user.role === "vendor") {
    const vendor = await currentVendorFor(req.user);
    res.json({
      items: vendor ? [vendorOut(vendor, { includeInternalNotes: false })] : [],
      total: vendor ? 1 : 0,
      page: 1,
      pageSize: 1,
    });
    return;
  }

  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || "all");
  const category = String(req.query.category || "all");
  const sort = String(req.query.sort || "updated");
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));

  const where = {};
  if (search) {
    where.OR = ["name", "code", "email", "contactName", "city"].map((field) => ({
      [field]: { contains: search, mode: "insensitive" },
    }));
  }
  if (status !== "all") {
    if (!VENDOR_STATUSES.includes(status)) {
      throw new ApiError(400, "Unknown vendor status filter.", { code: "invalid_filter" });
    }
    where.status = status;
  }
  if (category !== "all") {
    where.category = category;
  }

  const [items, total, counts] = await Promise.all([
    prisma.vendor.findMany({
      where,
      orderBy: ORDER_BY[sort] || ORDER_BY.updated,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.vendor.count({ where }),
    prisma.vendor.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  res.json({
    items: items.map(vendorOut),
    total,
    page,
    pageSize,
    statusCounts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
  });
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new ApiError(404, "Vendor not found.", { code: "not_found" });
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) throw new ApiError(404, "Vendor not found.", { code: "not_found" });
  if (req.user.role === "vendor" && vendor.userId !== req.user.id) {
    throw new ApiError(403, "You can only view your own vendor profile.", { code: "forbidden" });
  }
  res.json({
    vendor: vendorOut(vendor, { includeInternalNotes: req.user.role !== "vendor" }),
  });
});

router.post("/", requireRole("admin", "procurement"), async (req, res) => {
  const data = parse(vendorSchema, req.body);
  const duplicate = await prisma.vendor.findFirst({
    where: { name: { equals: data.name, mode: "insensitive" } },
  });
  if (duplicate) {
    throw new ApiError(409, "A vendor with that name already exists.", {
      code: "duplicate_vendor",
      fields: { name: "Vendor name must be unique." },
    });
  }

  const vendor = await prisma.$transaction(async (tx) => {
    const seq = await nextSequence("VND", tx);
    return tx.vendor.create({
      data: vendorData(data, {
        code: `VND-${String(seq).padStart(3, "0")}`,
        createdBy: req.user.id,
        createdAt: now(),
        updatedAt: now(),
      }),
    });
  });

  res.status(201).json({ vendor: vendorOut(vendor) });
});

router.put("/:id", requireRole("admin", "procurement"), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "Vendor not found.", { code: "not_found" });
  const data = parse(vendorSchema, req.body);
  const duplicate = await prisma.vendor.findFirst({
    where: { name: { equals: data.name, mode: "insensitive" }, id: { not: id } },
  });
  if (duplicate) {
    throw new ApiError(409, "Another vendor already uses that name.", {
      code: "duplicate_vendor",
      fields: { name: "Vendor name must be unique." },
    });
  }
  const vendor = await prisma.vendor.update({
    where: { id },
    data: vendorData(data, { updatedAt: now() }),
  });
  res.json({ vendor: vendorOut(vendor) });
});

router.delete("/:id", requireRole("admin", "procurement"), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "Vendor not found.", { code: "not_found" });
  try {
    await prisma.vendor.delete({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new ApiError(404, "Vendor not found.", { code: "not_found" });
    }
    throw error;
  }
  res.json({ ok: true });
});

export default router;
