import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { recordAudit } from "../audit.js";
import { notifyUsers } from "../notify.js";
import { ApiError, currentVendorFor, parse, requireAuth, requireRole } from "../auth.js";
import { invalidateCache } from "../cache.js";
import { nextSequence, now, prisma } from "../db.js";
import { purchaseOrderOut } from "../serializers.js";
import {
  documentIssues,
  documentNumber,
  lockRow,
  snapshotIssues,
} from "../workflow.js";

const router = Router();
router.use(requireAuth, requireRole("admin", "procurement", "manager", "vendor"));

const STAFF_ROLES = ["admin", "procurement", "manager"];
const GENERATE_ROLES = ["admin", "procurement"];

const PO_STATUSES = ["issued", "cancelled"];

const listQuerySchema = z.object({
  status: z.enum(["all", "issued", "cancelled"]).optional().default("all"),
  search: z.string().trim().max(120).optional().default(""),
  sort: z.enum(["issued_desc", "issued_asc"]).optional().default("issued_desc"),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
});

const generateSchema = z.object({
  approvalRequestId: z.coerce.number().int().positive("Choose an approved request to convert into a purchase order."),
});

const cancelSchema = z.object({
  reason: z.string().trim().min(5, "Explain why this purchase order is being cancelled.").max(500),
});

const poInclude = {
  rfq: { select: { id: true, reference: true, title: true, currency: true } },
  vendor: true,
  quotation: { select: { id: true, revision: true } },
  approvalRequest: {
    include: { approver: { select: { id: true, firstName: true, lastName: true } } },
  },
  creator: { select: { id: true, firstName: true, lastName: true } },
  items: { orderBy: { position: "asc" } },
  invoices: {
    select: {
      id: true,
      number: true,
      status: true,
      total: true,
      currency: true,
      issueDate: true,
      dueDate: true,
      emailStatus: true,
    },
  },
};

const poId = (raw) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(404, "Purchase order not found.", { code: "not_found" });
  }
  return id;
};

function isUniqueViolation(error) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function vendorScope(req) {
  const vendor = await currentVendorFor(req.user);
  if (!vendor) {
    throw new ApiError(403, "Your account is not linked to a vendor record.", {
      code: "vendor_profile_missing",
    });
  }
  return vendor;
}

/** Loads a PO and rejects access outside the caller's role or vendor scope. */
async function loadPurchaseOrder(req, id) {
  const purchaseOrder = await prisma.purchaseOrder.findUnique({ where: { id }, include: poInclude });
  if (!purchaseOrder) throw new ApiError(404, "Purchase order not found.", { code: "not_found" });

  if (!STAFF_ROLES.includes(req.user.role)) {
    const vendor = await vendorScope(req);
    if (purchaseOrder.vendorId !== vendor.id) {
      // Another vendor's document is reported as not found so IDs cannot be probed.
      throw new ApiError(404, "Purchase order not found.", { code: "not_found" });
    }
  }
  return purchaseOrder;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

router.get("/", async (req, res) => {
  const query = parse(listQuerySchema, req.query);
  const isStaff = STAFF_ROLES.includes(req.user.role);

  const where = {};
  if (!isStaff) {
    const vendor = await vendorScope(req);
    where.vendorId = vendor.id;
  }
  if (query.status !== "all") where.status = query.status;
  if (query.search) {
    where.OR = [
      { number: { contains: query.search, mode: "insensitive" } },
      { rfq: { reference: { contains: query.search, mode: "insensitive" } } },
      { rfq: { title: { contains: query.search, mode: "insensitive" } } },
      ...(isStaff ? [{ vendor: { name: { contains: query.search, mode: "insensitive" } } }] : []),
    ];
  }

  const orderBy =
    query.sort === "issued_asc" ? [{ issuedAt: "asc" }, { id: "asc" }] : [{ issuedAt: "desc" }, { id: "desc" }];

  const [rows, total, statusRows] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: poInclude,
    }),
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.groupBy({ by: ["status"], where: isStaff ? {} : { vendorId: where.vendorId }, _count: { _all: true } }),
  ]);

  const statusCounts = Object.fromEntries(PO_STATUSES.map((status) => [status, 0]));
  for (const row of statusRows) {
    if (Object.hasOwn(statusCounts, row.status)) statusCounts[row.status] = row._count._all;
  }

  res.json({
    items: rows.map((row) => purchaseOrderOut(row, { revealInternal: isStaff })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    statusCounts,
  });
});

// ---------------------------------------------------------------------------
// Generation (approved quotation only)
// ---------------------------------------------------------------------------

router.post("/", requireRole(...GENERATE_ROLES), async (req, res) => {
  const { approvalRequestId } = parse(generateSchema, req.body);
  const timestamp = now();

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // One row lock per approval: concurrent clicks queue here and the second
        // one returns the PO the first one created instead of a duplicate.
        await lockRow(tx, "approval_requests", approvalRequestId);

        const approval = await tx.approvalRequest.findUnique({
          where: { id: approvalRequestId },
          include: {
            rfq: { include: { items: true } },
            quotation: { include: { items: true, vendor: true } },
            purchaseOrder: true,
          },
        });
        if (!approval) throw new ApiError(404, "Approval request not found.", { code: "not_found" });

        if (approval.status !== "approved") {
          throw new ApiError(
            409,
            approval.status === "pending"
              ? "This request is still awaiting a decision. A purchase order can only be generated after approval."
              : "This quotation was rejected, so no purchase order can be generated.",
            { code: "approval_required" },
          );
        }

        if (approval.purchaseOrder) {
          return { purchaseOrder: approval.purchaseOrder, created: false };
        }

        const issues = [
          ...snapshotIssues(approval.snapshot, approval.quotation, approval.rfq),
        ];
        if (issues.length > 0) {
          throw new ApiError(409, issues[0], { code: "quotation_changed" });
        }

        const snapshot = approval.snapshot;
        const items = Array.isArray(snapshot.items) ? snapshot.items : [];
        if (items.length === 0) {
          throw new ApiError(409, "The approval snapshot has no line items.", { code: "document_inconsistent" });
        }

        const documentIssuesFound = documentIssues({
          items: items.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
          })),
          taxPercent: snapshot.taxPercent,
          subtotal: snapshot.subtotal,
          taxAmount: snapshot.taxAmount,
          shippingAmount: snapshot.shippingAmount,
          total: snapshot.total,
          currency: snapshot.currency,
          rfqCurrency: approval.rfq.currency,
        });
        if (documentIssuesFound.length > 0) {
          throw new ApiError(409, documentIssuesFound[0], { code: "document_inconsistent" });
        }

        const seq = await nextSequence("PO", tx);
        const purchaseOrder = await tx.purchaseOrder.create({
          data: {
            number: documentNumber("PO", seq),
            rfqId: approval.rfqId,
            quotationId: approval.quotationId,
            approvalRequestId: approval.id,
            vendorId: approval.quotation.vendorId,
            createdBy: req.user.id,
            currency: snapshot.currency,
            taxPercent: snapshot.taxPercent,
            subtotal: snapshot.subtotal,
            taxAmount: snapshot.taxAmount,
            shippingAmount: snapshot.shippingAmount,
            total: snapshot.total,
            status: "issued",
            issuedAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
            items: {
              create: items.map((line, index) => ({
                position: line.position ?? index + 1,
                description: line.description,
                quantity: line.quantity,
                unit: line.unit,
                unitPrice: line.unitPrice,
                lineTotal: line.lineTotal,
              })),
            },
          },
          include: poInclude,
        });

        await recordAudit(
          req,
          {
            action: "purchase_order.generated",
            entityType: "purchase_order",
            entityId: purchaseOrder.id,
            summary: `Generated ${purchaseOrder.number} from the approved quotation for ${approval.rfq.reference}.`,
            metadata: {
              number: purchaseOrder.number,
              rfqId: approval.rfqId,
              reference: approval.rfq.reference,
              approvalId: approval.id,
              quotationId: approval.quotationId,
              vendorId: purchaseOrder.vendorId,
              total: purchaseOrder.total.toFixed(2),
              currency: purchaseOrder.currency,
            },
          },
          { client: tx },
        );

        return { purchaseOrder, created: true };
      },
      { maxWait: 10000, timeout: 20000 },
    );

    // The dashboard's issued-PO value moves only when a document is created.
    if (result.created) await invalidateCache("dashboard");

    const full = await prisma.purchaseOrder.findUnique({ where: { id: result.purchaseOrder.id }, include: poInclude });
    if (result.created) {
      await notifyUsers(
        [full.vendor?.userId, full.approvalRequest?.requesterId],
        {
          type: "purchase_order.generated",
          title: "Purchase order issued",
          body: `${full.number} — ${full.rfq.reference} for ${full.total.toFixed(2)} ${full.currency}.`,
          entityType: "purchase_order",
          entityId: full.id,
          vendorId: full.vendorId,
        },
        { actorId: req.user.id },
      );
    }
    res.status(result.created ? 201 : 200).json({
      purchaseOrder: purchaseOrderOut(full, { revealInternal: true }),
      created: result.created,
      message: result.created
        ? `${full.number} generated from the approved quotation.`
        : `${full.number} already exists for this approval.`,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await prisma.purchaseOrder.findUnique({
        where: { approvalRequestId },
        include: poInclude,
      });
      if (existing) {
        res.status(200).json({
          purchaseOrder: purchaseOrderOut(existing, { revealInternal: true }),
          created: false,
          message: `${existing.number} already exists for this approval.`,
        });
        return;
      }
    }
    throw error;
  }
});

// ---------------------------------------------------------------------------
// Detail / cancel
// ---------------------------------------------------------------------------

router.get("/:id", async (req, res) => {
  const purchaseOrder = await loadPurchaseOrder(req, poId(req.params.id));
  const isStaff = STAFF_ROLES.includes(req.user.role);
  res.json({
    purchaseOrder: purchaseOrderOut(purchaseOrder, { revealInternal: isStaff }),
    actions: {
      canGenerateInvoice:
        GENERATE_ROLES.includes(req.user.role) &&
        purchaseOrder.status === "issued" &&
        (purchaseOrder.invoices ?? []).length === 0,
      canCancel: GENERATE_ROLES.includes(req.user.role) && purchaseOrder.status === "issued" && (purchaseOrder.invoices ?? []).length === 0,
    },
  });
});

router.post("/:id/cancel", requireRole(...GENERATE_ROLES), async (req, res) => {
  const id = poId(req.params.id);
  const { reason } = parse(cancelSchema, req.body);

  const updated = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "purchase_orders", id);
    const existing = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { invoices: { select: { id: true } } },
    });
    if (!existing) throw new ApiError(404, "Purchase order not found.", { code: "not_found" });
    if (existing.status !== "issued") {
      throw new ApiError(409, "Only an issued purchase order can be cancelled.", { code: "invalid_transition" });
    }
    if (existing.invoices.length > 0) {
      throw new ApiError(409, "This purchase order already has an invoice and can no longer be cancelled.", {
        code: "invoice_exists",
      });
    }

    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: { status: "cancelled", cancelledAt: now(), cancelReason: reason, updatedAt: now() },
      include: poInclude,
    });
    await recordAudit(
      req,
      {
        action: "purchase_order.cancelled",
        entityType: "purchase_order",
        entityId: id,
        summary: `Cancelled ${updated.number} — ${reason}`,
        metadata: { number: updated.number, reason, total: updated.total.toFixed(2), currency: updated.currency },
      },
      { client: tx },
    );
    return updated;
  });

  await invalidateCache("dashboard");
  res.json({ purchaseOrder: purchaseOrderOut(updated, { revealInternal: true }) });
});

export default router;
