import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiError, currentVendorFor, parse, requireAuth, requireRole } from "../auth.js";
import { nextSequence, now, prisma } from "../db.js";
import {
  SUPPORTED_CURRENCIES,
  computeQuotationTotals,
  lineTotalFor,
  roundMoney,
  toDecimal,
} from "../money.js";
import {
  quotationOut,
  rfqDetailOut,
  rfqItemOut,
  rfqSummaryOut,
  rfqSubmissionOut,
} from "../serializers.js";

const router = Router();
router.use(requireAuth);

const STAFF_ROLES = ["admin", "procurement", "manager"];
const WRITE_ROLES = ["admin", "procurement"];

// Units are intentionally a closed list: the comparison screen groups prices by
// the requested unit, so free-text units would make totals incomparable.
const UNITS = ["unit", "pcs", "box", "pack", "set", "kg", "litre", "metre", "sheet", "hour", "day"];

const RFQ_STATUSES = ["draft", "open", "closed", "cancelled"];

const RFQ_ORDER = {
  deadline: [{ deadline: "asc" }, { id: "asc" }],
  created: [{ createdAt: "desc" }, { id: "desc" }],
  reference: [{ reference: "asc" }],
  title: [{ title: "asc" }, { id: "asc" }],
};

const QUOTATION_ORDER = {
  total_asc: [{ total: "asc" }, { submittedAt: "asc" }],
  total_desc: [{ total: "desc" }, { submittedAt: "asc" }],
  submitted: [{ submittedAt: "desc" }],
  vendor: [{ vendor: { name: "asc" } }],
};

function rfqId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(404, "RFQ not found.", { code: "not_found" });
  }
  return id;
}

/**
 * Decimal-aware input validation. Accepts a JSON number or a numeric string and
 * rejects NaN/Infinity, excess decimal places and out-of-range values before the
 * value ever reaches Prisma.
 */
function decimalField({ label, min, max, maxDecimals }) {
  return z
    .union([z.number(), z.string()])
    .transform((value, ctx) => {
      if (typeof value === "number" && !Number.isFinite(value)) {
        ctx.addIssue({ code: "custom", message: `${label} must be a finite number.` });
        return z.NEVER;
      }
      const raw = typeof value === "string" ? value.trim() : value;
      if (raw === "") {
        ctx.addIssue({ code: "custom", message: `${label} is required.` });
        return z.NEVER;
      }
      let decimal;
      try {
        decimal = toDecimal(raw);
      } catch {
        ctx.addIssue({ code: "custom", message: `${label} must be a number.` });
        return z.NEVER;
      }
      if (!decimal.isFinite()) {
        ctx.addIssue({ code: "custom", message: `${label} must be a finite number.` });
        return z.NEVER;
      }
      if (decimal.decimalPlaces() > maxDecimals) {
        ctx.addIssue({
          code: "custom",
          message: `${label} supports at most ${maxDecimals} decimal place${maxDecimals === 1 ? "" : "s"}.`,
        });
        return z.NEVER;
      }
      if (decimal.lessThan(min)) {
        ctx.addIssue({ code: "custom", message: `${label} cannot be lower than ${min.toString()}.` });
        return z.NEVER;
      }
      if (decimal.greaterThan(max)) {
        ctx.addIssue({ code: "custom", message: `${label} cannot be greater than ${max.toString()}.` });
        return z.NEVER;
      }
      return decimal;
    });
}

const itemSchema = z.object({
  description: z.string().trim().min(3, "Describe the requested item.").max(240),
  quantity: decimalField({
    label: "Quantity",
    min: new Prisma.Decimal("0.001"),
    max: new Prisma.Decimal("1000000"),
    maxDecimals: 3,
  }),
  unit: z.enum(UNITS),
  specifications: z.string().trim().max(500).optional().default(""),
});

const vendorIdsSchema = z
  .array(z.number().int().positive())
  .max(50)
  .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Each vendor can only be assigned once.",
      });
    }
  });

const deadlineField = z.coerce.date();

const rfqFields = {
  title: z.string().trim().min(3, "Enter an RFQ title.").max(140),
  description: z.string().trim().max(3000).optional().default(""),
  currency: z.enum(SUPPORTED_CURRENCIES, {
    errorMap: () => ({ message: "Choose a supported currency." }),
  }),
  deadline: deadlineField,
  items: z.array(itemSchema).min(1, "Add at least one requested item.").max(40),
};

const createRfqSchema = z.object({
  ...rfqFields,
  vendorIds: vendorIdsSchema.optional().default([]),
});

const updateRfqSchema = z.object(rfqFields);

const assignVendorsSchema = z.object({ vendorIds: vendorIdsSchema });

const listQuerySchema = z.object({
  search: z.string().trim().max(120).optional().default(""),
  status: z.enum(["all", "draft", "open", "expired", "closed", "cancelled"]).optional().default("all"),
  sort: z.enum(["deadline", "created", "reference", "title"]).optional().default("deadline"),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
});

const quotationSchema = z
  .object({
    deliveryDays: z.coerce
      .number()
      .int("Delivery timeline must be a whole number of days.")
      .min(0, "Delivery timeline cannot be negative.")
      .max(3650, "Delivery timeline is too far in the future."),
    deliveryTerms: z.string().trim().max(240).optional().default(""),
    notes: z.string().trim().max(2000).optional().default(""),
    taxPercent: decimalField({
      label: "Tax",
      min: new Prisma.Decimal(0),
      max: new Prisma.Decimal(100),
      maxDecimals: 2,
    })
      .optional()
      .default(0),
    shippingAmount: decimalField({
      label: "Shipping",
      min: new Prisma.Decimal(0),
      max: new Prisma.Decimal("1000000000"),
      maxDecimals: 2,
    })
      .optional()
      .default(0),
    items: z
      .array(
        z.object({
          rfqItemId: z.number().int().positive(),
          unitPrice: decimalField({
            label: "Unit price",
            min: new Prisma.Decimal(0),
            max: new Prisma.Decimal("1000000000"),
            maxDecimals: 2,
          }),
        }),
      )
      .min(1, "Price at least one requested item.")
      .max(40),
  })
  .superRefine((value, ctx) => {
    const seen = new Set();
    value.items.forEach((line, index) => {
      if (seen.has(line.rfqItemId)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "rfqItemId"],
          message: "Each requested item can only be priced once.",
        });
      }
      seen.add(line.rfqItemId);
    });
  });

const detailInclude = {
  items: { orderBy: { position: "asc" } },
  assignments: {
    orderBy: { id: "asc" },
    include: { vendor: { select: { id: true, name: true, code: true, status: true } } },
  },
  creator: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { items: true, assignments: true, quotations: { where: { status: "submitted" } } } },
};

const quotationInclude = { items: { orderBy: { id: "asc" } } };

function assertFutureDeadline(deadline) {
  if (!(deadline instanceof Date) || Number.isNaN(deadline.getTime())) {
    throw new ApiError(422, "Enter a valid submission deadline.", {
      code: "validation_failed",
      fields: { deadline: "Enter a valid deadline." },
    });
  }
  if (deadline.getTime() <= Date.now()) {
    throw new ApiError(422, "The submission deadline must be in the future.", {
      code: "validation_failed",
      fields: { deadline: "Choose a deadline in the future." },
    });
  }
}

async function assertVendorsExist(tx, vendorIds) {
  if (vendorIds.length === 0) return;
  const found = await tx.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true } });
  if (found.length !== vendorIds.length) {
    throw new ApiError(422, "One or more selected vendors are no longer in the register.", {
      code: "validation_failed",
      fields: { vendorIds: "Select vendors that exist in the supplier register." },
    });
  }
}

async function vendorContext(req) {
  const vendor = await currentVendorFor(req.user);
  if (!vendor) {
    throw new ApiError(403, "Your account is not linked to a vendor record.", {
      code: "vendor_profile_missing",
    });
  }
  return vendor;
}

/** Why a vendor cannot submit right now — also rendered by the UI. */
function submissionState(rfq) {
  const deadlinePassed = rfq.deadline.getTime() <= Date.now();
  if (rfq.status === "draft") {
    return { canSubmit: false, reason: "This RFQ has not been published yet." };
  }
  if (rfq.status === "cancelled") {
    return { canSubmit: false, reason: "This RFQ was cancelled." };
  }
  if (rfq.status === "closed") {
    return { canSubmit: false, reason: "This RFQ is closed and no longer accepts quotations." };
  }
  if (deadlinePassed) {
    return { canSubmit: false, reason: "The submission deadline has passed." };
  }
  return { canSubmit: true, reason: null };
}

function buildSubmissions(rfq, quotations) {
  const byVendor = new Map(quotations.map((quotation) => [quotation.vendorId, quotation]));
  return (rfq.assignments ?? []).map((assignment) =>
    rfqSubmissionOut(assignment, byVendor.get(assignment.vendorId) ?? null),
  );
}

function lineItemsFor(rfq, submittedItems) {
  const itemsById = new Map(rfq.items.map((item) => [item.id, item]));
  return submittedItems.map((line) => {
    const item = itemsById.get(line.rfqItemId);
    const lineTotal = lineTotalFor(line.unitPrice, item.quantity);
    return { rfqItemId: item.id, unitPrice: line.unitPrice, lineTotal };
  });
}

async function quoteTotalsFor(rfq, data) {
  const expectedIds = new Set(rfq.items.map((item) => item.id));
  const submittedIds = new Set(data.items.map((line) => line.rfqItemId));
  if (
    data.items.length !== expectedIds.size ||
    data.items.some((line) => !expectedIds.has(line.rfqItemId))
  ) {
    throw new ApiError(422, "Price every requested line item exactly once.", {
      code: "validation_failed",
      fields: { items: "Each requested line item must be priced exactly once." },
    });
  }
  const lines = lineItemsFor(rfq, data.items);
  const totals = computeQuotationTotals({
    lines,
    taxPercent: data.taxPercent,
    shippingAmount: data.shippingAmount,
  });
  return { lines, totals };
}

/**
 * Comparison is deliberately conservative: every quotation is re-validated
 * against the RFQ before it can be highlighted. A quotation is excluded when
 * its currency differs, it does not price exactly the requested items, or its
 * stored totals disagree with the server-side recalculation.
 */
function buildComparison(rfq, quotations) {
  const itemsById = new Map(rfq.items.map((item) => [item.id, item]));

  const entries = quotations.map((quotation) => {
    const reasons = [];

    if (quotation.currency !== rfq.currency) {
      reasons.push(`Quoted in ${quotation.currency}; this RFQ is priced in ${rfq.currency}.`);
    }

    const seen = new Set(quotation.items.map((line) => line.rfqItemId));
    const missing = rfq.items.filter((item) => !seen.has(item.id));
    if (missing.length > 0) {
      reasons.push(
        `${missing.length} requested item${missing.length === 1 ? " is" : "s are"} not priced.`,
      );
    }
    if (quotation.items.some((line) => !itemsById.has(line.rfqItemId))) {
      reasons.push("Prices items that are not part of this RFQ.");
    }

    const lines = quotation.items
      .filter((line) => itemsById.has(line.rfqItemId))
      .map((line) => ({
        rfqItemId: line.rfqItemId,
        unitPrice: line.unitPrice,
        lineTotal: lineTotalFor(line.unitPrice, itemsById.get(line.rfqItemId).quantity),
      }));

    for (const line of quotation.items) {
      const item = itemsById.get(line.rfqItemId);
      if (!item) continue;
      const expected = lineTotalFor(line.unitPrice, item.quantity);
      if (!expected.equals(line.lineTotal)) {
        reasons.push("A line total does not match the requested quantity and unit price.");
        break;
      }
    }

    const totals = computeQuotationTotals({
      lines,
      taxPercent: quotation.taxPercent,
      shippingAmount: quotation.shippingAmount,
    });
    if (!totals.subtotal.equals(quotation.subtotal) || !totals.total.equals(quotation.total)) {
      reasons.push("Stored totals do not match the server-side calculation.");
    }

    return { quotation, reasons, lines };
  });

  const comparable = entries.filter((entry) => entry.reasons.length === 0);

  let lowest = null;
  for (const entry of comparable) {
    if (!lowest) {
      lowest = entry;
      continue;
    }
    const comparison = entry.quotation.total.comparedTo(lowest.quotation.total);
    if (
      comparison < 0 ||
      (comparison === 0 && entry.quotation.submittedAt < lowest.quotation.submittedAt)
    ) {
      lowest = entry;
    }
  }

  const items = rfq.items.map(rfqItemOut);

  return {
    rfq: rfqSummaryOut(rfq),
    items,
    basis: {
      currency: rfq.currency,
      includesTax: true,
      includesShipping: true,
      comparisonField: "total",
      totalDefinition:
        "Server-calculated total: each unit price × requested quantity, plus tax percentage and delivery charges.",
    },
    summary: {
      quotationCount: entries.length,
      comparableCount: comparable.length,
      excludedCount: entries.length - comparable.length,
      lowestTotal: lowest ? lowest.quotation.total.toFixed(2) : null,
      canCompare: comparable.length > 0,
    },
    lowest: lowest
      ? {
          quotationId: lowest.quotation.id,
          vendorId: lowest.quotation.vendorId,
          vendorName: lowest.quotation.vendor?.name ?? null,
          vendorCode: lowest.quotation.vendor?.code ?? null,
          total: lowest.quotation.total.toFixed(2),
          deliveryDays: lowest.quotation.deliveryDays,
          submittedAt: lowest.quotation.submittedAt.toISOString(),
        }
      : null,
    quotations: entries.map(({ quotation, reasons, lines }) => ({
      ...quotationOut(quotation),
      compatible: reasons.length === 0,
      exclusionReasons: reasons,
      isLowest: lowest ? lowest.quotation.id === quotation.id : false,
      calculatedLines: lines.map((line) => ({
        rfqItemId: line.rfqItemId,
        unitPrice: line.unitPrice.toFixed(2),
        lineTotal: line.lineTotal.toFixed(2),
      })),
    })),
    excluded: entries
      .filter((entry) => entry.reasons.length > 0)
      .map((entry) => ({
        quotationId: entry.quotation.id,
        vendorId: entry.quotation.vendorId,
        vendorName: entry.quotation.vendor?.name ?? null,
        reasons: entry.reasons,
      })),
  };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

router.get("/", async (req, res) => {
  const query = parse(listQuerySchema, req.query);
  const isStaff = STAFF_ROLES.includes(req.user.role);
  const vendor = isStaff ? null : await vendorContext(req);
  const at = now();

  // Vendors only ever see published RFQs assigned to their linked vendor record;
  // drafts are internal until procurement publishes them.
  const scoped = isStaff
    ? {}
    : { AND: [{ assignments: { some: { vendorId: vendor.id } } }, { status: { not: "draft" } }] };

  const baseWhere = { ...scoped };
  if (query.search) {
    baseWhere.OR = ["reference", "title", "description"].map((field) => ({
      [field]: { contains: query.search, mode: "insensitive" },
    }));
  }

  const where = { ...baseWhere };
  if (query.status === "open") {
    where.status = "open";
    where.deadline = { gt: at };
  } else if (query.status === "expired") {
    where.status = "open";
    where.deadline = { lte: at };
  } else if (query.status !== "all") {
    where.status = query.status;
  }

  const [rows, total, statusRows, expiredCount] = await Promise.all([
    prisma.rfq.findMany({
      where,
      orderBy: RFQ_ORDER[query.sort],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        creator: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { items: true, assignments: true, quotations: { where: { status: "submitted" } } } },
      },
    }),
    prisma.rfq.count({ where }),
    prisma.rfq.groupBy({ by: ["status"], where: baseWhere, _count: { _all: true } }),
    prisma.rfq.count({ where: { ...baseWhere, status: "open", deadline: { lte: at } } }),
  ]);

  const counts = Object.fromEntries(RFQ_STATUSES.map((status) => [status, 0]));
  counts.expired = expiredCount;
  for (const row of statusRows) {
    const count = row._count._all;
    if (row.status === "open") {
      // `open` in the UI means "still accepting quotations", so the expired
      // tail of the open bucket is reported separately.
      counts.open = count - expiredCount;
    } else if (Object.hasOwn(counts, row.status)) {
      counts[row.status] = count;
    }
  }

  let myQuotations = new Map();
  if (vendor) {
    const quotations = await prisma.quotation.findMany({
      where: { vendorId: vendor.id, rfqId: { in: rows.map((row) => row.id) }, status: "submitted" },
      select: { id: true, rfqId: true, total: true, submittedAt: true, revision: true },
    });
    myQuotations = new Map(quotations.map((quotation) => [quotation.rfqId, quotation]));
  }

  res.json({
    items: rows.map((row) => {
      const quotation = myQuotations.get(row.id);
      return rfqSummaryOut(row, {
        ...(vendor
          ? {
              hasSubmitted: Boolean(quotation),
              myQuotation: quotation
                ? {
                    id: quotation.id,
                    total: quotation.total.toFixed(2),
                    submittedAt: quotation.submittedAt.toISOString(),
                    revision: quotation.revision,
                  }
                : null,
            }
          : {}),
      });
    }),
    total,
    page: query.page,
    pageSize: query.pageSize,
    statusCounts: counts,
  });
});

// ---------------------------------------------------------------------------
// Creation and draft editing (Admin, Procurement)
// ---------------------------------------------------------------------------

router.post("/", requireRole(...WRITE_ROLES), async (req, res) => {
  const data = parse(createRfqSchema, req.body);
  assertFutureDeadline(data.deadline);
  const vendorIds = data.vendorIds;

  let created = null;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    try {
      created = await prisma.$transaction(
        async (tx) => {
          await assertVendorsExist(tx, vendorIds);
          const seq = await nextSequence("RFQ", tx);
          const timestamp = now();
          return tx.rfq.create({
            data: {
              reference: `RFQ-${String(seq).padStart(4, "0")}`,
              title: data.title,
              description: data.description || null,
              currency: data.currency,
              status: "draft",
              deadline: data.deadline,
              createdBy: req.user.id,
              createdAt: timestamp,
              updatedAt: timestamp,
              items: {
                create: data.items.map((item, index) => ({
                  position: index + 1,
                  description: item.description,
                  quantity: item.quantity,
                  unit: item.unit,
                  specifications: item.specifications || null,
                })),
              },
              assignments:
                vendorIds.length > 0
                  ? {
                      create: vendorIds.map((vendorId) => ({ vendorId, assignedAt: timestamp })),
                    }
                  : undefined,
            },
            include: detailInclude,
          });
        },
        { timeout: 20000 },
      );
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 2) continue;
      throw error;
    }
  }

  res.status(201).json({
    rfq: rfqDetailOut(created, { submissions: buildSubmissions(created, []) }),
  });
});

router.put("/:id", requireRole(...WRITE_ROLES), async (req, res) => {
  const id = rfqId(req.params.id);
  const data = parse(updateRfqSchema, req.body);
  assertFutureDeadline(data.deadline);

  const updated = await prisma.$transaction(
    async (tx) => {
      const existing = await tx.rfq.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!existing) throw new ApiError(404, "RFQ not found.", { code: "not_found" });
      if (existing.status !== "draft") {
        throw new ApiError(409, "Only draft RFQs can be edited.", {
          code: "invalid_transition",
          fields: { status: "Published RFQs can no longer be edited." },
        });
      }

      await tx.rfqItem.deleteMany({ where: { rfqId: id } });
      await tx.rfq.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description || null,
          currency: data.currency,
          deadline: data.deadline,
          updatedAt: now(),
          items: {
            create: data.items.map((item, index) => ({
              position: index + 1,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              specifications: item.specifications || null,
            })),
          },
        },
      });

      return tx.rfq.findUnique({ where: { id }, include: detailInclude });
    },
    { timeout: 20000 },
  );

  res.json({ rfq: rfqDetailOut(updated, { submissions: [] }) });
});

router.put("/:id/vendors", requireRole(...WRITE_ROLES), async (req, res) => {
  const id = rfqId(req.params.id);
  const { vendorIds } = parse(assignVendorsSchema, req.body);

  const updated = await prisma.$transaction(
    async (tx) => {
      const existing = await tx.rfq.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!existing) throw new ApiError(404, "RFQ not found.", { code: "not_found" });
      if (existing.status !== "draft") {
        throw new ApiError(409, "Vendor assignments are locked once an RFQ is published.", {
          code: "invalid_transition",
          fields: { status: "Assignments can only change while the RFQ is a draft." },
        });
      }

      await assertVendorsExist(tx, vendorIds);
      const timestamp = now();
      await tx.rfqAssignment.deleteMany({ where: { rfqId: id } });
      if (vendorIds.length > 0) {
        await tx.rfqAssignment.createMany({
          data: vendorIds.map((vendorId) => ({ rfqId: id, vendorId, assignedAt: timestamp })),
        });
      }
      await tx.rfq.update({ where: { id }, data: { updatedAt: timestamp } });
      return tx.rfq.findUnique({ where: { id }, include: detailInclude });
    },
    { timeout: 20000 },
  );

  res.json({ rfq: rfqDetailOut(updated, { submissions: [] }) });
});

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

router.post("/:id/publish", requireRole(...WRITE_ROLES), async (req, res) => {
  const id = rfqId(req.params.id);
  const rfq = await prisma.rfq.findUnique({
    where: { id },
    include: { items: { select: { id: true } }, assignments: { select: { id: true } } },
  });
  if (!rfq) throw new ApiError(404, "RFQ not found.", { code: "not_found" });
  if (rfq.status !== "draft") {
    throw new ApiError(409, "Only draft RFQs can be published.", {
      code: "invalid_transition",
      fields: { status: "This RFQ is already published or closed." },
    });
  }
  if (rfq.items.length === 0) {
    throw new ApiError(422, "Add at least one requested item before publishing.", {
      code: "validation_failed",
      fields: { items: "Add at least one line item." },
    });
  }
  if (rfq.assignments.length === 0) {
    throw new ApiError(422, "Assign at least one vendor before publishing.", {
      code: "validation_failed",
      fields: { vendorIds: "Select at least one vendor." },
    });
  }
  assertFutureDeadline(rfq.deadline);

  const result = await prisma.rfq.updateMany({
    where: { id, status: "draft" },
    data: { status: "open", publishedAt: now(), updatedAt: now() },
  });
  if (result.count !== 1) {
    throw new ApiError(409, "This RFQ was changed by another request. Reload and try again.", {
      code: "invalid_transition",
    });
  }

  const updated = await prisma.rfq.findUnique({ where: { id }, include: detailInclude });
  res.json({ rfq: rfqDetailOut(updated, { submissions: buildSubmissions(updated, []) }) });
});

router.post("/:id/close", requireRole(...WRITE_ROLES), async (req, res) => {
  const id = rfqId(req.params.id);
  const rfq = await prisma.rfq.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!rfq) throw new ApiError(404, "RFQ not found.", { code: "not_found" });
  if (rfq.status !== "open") {
    throw new ApiError(409, "Only open RFQs can be closed.", {
      code: "invalid_transition",
      fields: { status: "This RFQ is not accepting quotations." },
    });
  }

  const result = await prisma.rfq.updateMany({
    where: { id, status: "open" },
    data: { status: "closed", closedAt: now(), updatedAt: now() },
  });
  if (result.count !== 1) {
    throw new ApiError(409, "This RFQ was changed by another request. Reload and try again.", {
      code: "invalid_transition",
    });
  }

  const updated = await prisma.rfq.findUnique({ where: { id }, include: detailInclude });
  const quotations = await prisma.quotation.findMany({
    where: { rfqId: id, status: "submitted" },
    select: { id: true, vendorId: true, total: true, submittedAt: true, revision: true },
  });
  res.json({ rfq: rfqDetailOut(updated, { submissions: buildSubmissions(updated, quotations) }) });
});

router.post("/:id/cancel", requireRole(...WRITE_ROLES), async (req, res) => {
  const id = rfqId(req.params.id);
  const rfq = await prisma.rfq.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!rfq) throw new ApiError(404, "RFQ not found.", { code: "not_found" });
  if (rfq.status !== "draft" && rfq.status !== "open") {
    throw new ApiError(409, "This RFQ can no longer be cancelled.", {
      code: "invalid_transition",
      fields: { status: "Only draft or open RFQs can be cancelled." },
    });
  }

  const result = await prisma.rfq.updateMany({
    where: { id, status: { in: ["draft", "open"] } },
    data: { status: "cancelled", cancelledAt: now(), updatedAt: now() },
  });
  if (result.count !== 1) {
    throw new ApiError(409, "This RFQ was changed by another request. Reload and try again.", {
      code: "invalid_transition",
    });
  }

  const updated = await prisma.rfq.findUnique({ where: { id }, include: detailInclude });
  res.json({ rfq: rfqDetailOut(updated, { submissions: [] }) });
});

// ---------------------------------------------------------------------------
// Detail and staff-only quotation review
// ---------------------------------------------------------------------------

router.get("/:id/quotations", requireRole(...STAFF_ROLES), async (req, res) => {
  const id = rfqId(req.params.id);
  const sort = String(req.query.sort || "total_asc");
  if (!(sort in QUOTATION_ORDER)) {
    throw new ApiError(400, "Unknown quotation sort order.", { code: "invalid_filter" });
  }

  const rfq = await prisma.rfq.findUnique({
    where: { id },
    include: {
      items: { orderBy: { position: "asc" } },
      _count: { select: { items: true, assignments: true, quotations: { where: { status: "submitted" } } } },
    },
  });
  if (!rfq) throw new ApiError(404, "RFQ not found.", { code: "not_found" });

  const quotations = await prisma.quotation.findMany({
    where: { rfqId: id },
    orderBy: QUOTATION_ORDER[sort],
    include: { ...quotationInclude, vendor: { select: { id: true, name: true, code: true } } },
  });

  res.json({
    rfq: rfqSummaryOut(rfq),
    items: rfq.items.map(rfqItemOut),
    quotations: quotations.map((quotation) => quotationOut(quotation)),
    summary: { count: quotations.length },
  });
});

router.get("/:id/comparison", requireRole(...STAFF_ROLES), async (req, res) => {
  const id = rfqId(req.params.id);
  const rfq = await prisma.rfq.findUnique({
    where: { id },
    include: {
      items: { orderBy: { position: "asc" } },
      creator: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { items: true, assignments: true, quotations: { where: { status: "submitted" } } } },
    },
  });
  if (!rfq) throw new ApiError(404, "RFQ not found.", { code: "not_found" });

  // Drafts have no visible submissions, but the comparison screen still
  // renders an explicit empty state instead of erroring.
  const quotations = await prisma.quotation.findMany({
    where: { rfqId: id, status: "submitted" },
    orderBy: [{ total: "asc" }, { submittedAt: "asc" }],
    include: {
      ...quotationInclude,
      vendor: { select: { id: true, name: true, code: true } },
    },
  });

  res.json(buildComparison(rfq, quotations));
});

router.get("/:id", async (req, res) => {
  const id = rfqId(req.params.id);
  const isStaff = STAFF_ROLES.includes(req.user.role);
  const vendor = isStaff ? null : await vendorContext(req);

  const rfq = await prisma.rfq.findUnique({ where: { id }, include: detailInclude });
  if (!rfq) throw new ApiError(404, "RFQ not found.", { code: "not_found" });

  if (!isStaff) {
    const assigned = rfq.assignments.some((assignment) => assignment.vendorId === vendor.id);
    // Unassigned RFQs are reported as not found so vendors cannot probe which
    // references exist.
    if (!assigned || rfq.status === "draft") {
      throw new ApiError(404, "RFQ not found.", { code: "not_found" });
    }
    const quotation = await prisma.quotation.findFirst({
      where: { rfqId: id, vendorId: vendor.id, status: "submitted" },
      include: quotationInclude,
      orderBy: { revision: "desc" },
    });
    res.json({
      rfq: rfqDetailOut(rfq, { includeAssignments: false }),
      myQuotation: quotationOut(quotation, { includeVendor: false }),
      submission: submissionState(rfq),
    });
    return;
  }

  const quotations = await prisma.quotation.findMany({
    where: { rfqId: id, status: "submitted" },
    select: { id: true, vendorId: true, total: true, submittedAt: true, revision: true },
  });
  res.json({
    rfq: rfqDetailOut(rfq, { submissions: buildSubmissions(rfq, quotations) }),
    myQuotation: null,
    submission: null,
  });
});

// ---------------------------------------------------------------------------
// Vendor submission: every edit creates a new immutable quotation revision.
// ---------------------------------------------------------------------------

router.put("/:id/quotation", requireRole("vendor"), async (req, res) => {
  const id = rfqId(req.params.id);
  const vendor = await vendorContext(req);
  const data = parse(quotationSchema, req.body);

  const rfq = await prisma.rfq.findUnique({
    where: { id },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (!rfq) throw new ApiError(404, "RFQ not found.", { code: "not_found" });

  const assignment = await prisma.rfqAssignment.findUnique({
    where: { rfqId_vendorId: { rfqId: id, vendorId: vendor.id } },
    select: { id: true },
  });
  if (!assignment) {
    throw new ApiError(403, "This RFQ was not assigned to your vendor account.", {
      code: "not_assigned",
    });
  }

  const state = submissionState(rfq);
  if (!state.canSubmit) {
    throw new ApiError(409, state.reason, {
      code: rfq.status === "open" ? "rfq_expired" : "rfq_not_accepting",
    });
  }

  const { lines, totals } = await quoteTotalsFor(rfq, data);
  const timestamp = now();
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      // A shared RFQ lock is compatible across different vendors but blocks
      // concurrent close/cancel updates until this submission commits.
      const locked = await tx.$queryRaw`SELECT "status", "deadline" FROM "rfqs" WHERE "id" = ${id} FOR SHARE`;
      if (!locked.length || locked[0].status !== "open" || new Date(locked[0].deadline).getTime() <= Date.now()) {
        throw new ApiError(409, "This RFQ is closed or its submission deadline has passed.", {
          code: "rfq_not_accepting",
        });
      }

      // Serialize same-vendor revisions while allowing other vendors to submit
      // concurrently. The partial unique index is the final database backstop.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${id}, ${vendor.id})`;
      const previous = await tx.quotation.findFirst({
        where: { rfqId: id, vendorId: vendor.id, status: "submitted" },
        orderBy: { revision: "desc" },
        select: { id: true, revision: true },
      });

      if (previous) {
        await tx.quotation.update({
          where: { id: previous.id },
          data: { status: "superseded", supersededAt: timestamp, updatedAt: timestamp },
        });
      }

      const revision = (previous?.revision ?? 0) + 1;
      const quotation = await tx.quotation.create({
        data: {
          rfqId: id,
          vendorId: vendor.id,
          currency: rfq.currency,
          deliveryDays: data.deliveryDays,
          deliveryTerms: data.deliveryTerms || null,
          notes: data.notes || null,
          taxPercent: roundMoney(data.taxPercent),
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          shippingAmount: totals.shippingAmount,
          total: totals.total,
          revision,
          supersedesId: previous?.id ?? null,
          submittedAt: timestamp,
          updatedAt: timestamp,
          items: { create: lines },
        },
        include: quotationInclude,
      });
      return { created: !previous, quotation };
    }, { timeout: 20000 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2004" &&
      `${error.message} ${JSON.stringify(error.meta ?? {})}`.includes("quotations_rfq_deadline_check")
    ) {
      throw new ApiError(409, "This RFQ is closed or its submission deadline has passed.", {
        code: "rfq_not_accepting",
      });
    }
    throw error;
  }

  res.status(result.created ? 201 : 200).json({
    quotation: quotationOut(result.quotation, { includeVendor: false }),
    revision: result.quotation.revision,
    message: result.created
      ? "Quotation submitted."
      : `Quotation updated (revision ${result.quotation.revision}).`,
  });
});

export default router;
