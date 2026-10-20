import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiError, parse, requireAuth, requireRole } from "../auth.js";
import { invalidateCache } from "../cache.js";
import { nextSequence, now, prisma } from "../db.js";
import {
  approvalOut,
  purchaseOrderOut,
  quotationOut,
  rfqItemOut,
  rfqSummaryOut,
} from "../serializers.js";
import { buildQuotationSnapshot, lockRow, quotationIssues, snapshotIssues } from "../workflow.js";

const router = Router();
router.use(requireAuth, requireRole("admin", "procurement", "manager"));

const REQUEST_ROLES = ["admin", "procurement"];
const DECIDE_ROLES = ["admin", "manager"];
const APPROVAL_STATUSES = ["pending", "approved", "rejected"];

const approvalId = (raw) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(404, "Approval request not found.", { code: "not_found" });
  }
  return id;
};

const listQuerySchema = z.object({
  status: z.enum(["all", "pending", "approved", "rejected"]).optional().default("all"),
  search: z.string().trim().max(120).optional().default(""),
  sort: z.enum(["requested_desc", "requested_asc"]).optional().default("requested_desc"),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
});

const requestSchema = z.object({
  quotationId: z.coerce.number().int().positive("Choose a quotation to request approval for."),
  remarks: z.string().trim().max(1000).optional().default(""),
});

const decisionSchema = z.object({
  remarks: z.string().trim().max(1000).optional().default(""),
});

const rejectionSchema = z.object({
  remarks: z
    .string()
    .trim()
    .min(5, "Explain why this quotation is being rejected.")
    .max(1000, "Keep the rejection note under 1000 characters."),
});

const listInclude = {
  rfq: { select: { id: true, reference: true, title: true, currency: true } },
  requester: { select: { id: true, firstName: true, lastName: true } },
  approver: { select: { id: true, firstName: true, lastName: true } },
  purchaseOrder: { select: { id: true, number: true, status: true } },
};

const detailInclude = {
  rfq: {
    select: {
      id: true,
      reference: true,
      title: true,
      currency: true,
      status: true,
      deadline: true,
      items: { orderBy: { position: "asc" } },
    },
  },
  quotation: { include: { items: { orderBy: { id: "asc" } }, vendor: true } },
  requester: { select: { id: true, firstName: true, lastName: true } },
  approver: { select: { id: true, firstName: true, lastName: true } },
  events: {
    orderBy: { createdAt: "asc" },
    include: { actor: { select: { id: true, firstName: true, lastName: true } } },
  },
  purchaseOrder: {
    include: {
      rfq: { select: { id: true, reference: true, title: true } },
      vendor: true,
      quotation: { select: { id: true, revision: true } },
      approvalRequest: {
        include: { approver: { select: { id: true, firstName: true, lastName: true } } },
      },
      creator: { select: { id: true, firstName: true, lastName: true } },
      items: { orderBy: { position: "asc" } },
      invoices: { select: { id: true, number: true, status: true, total: true, currency: true, issueDate: true, dueDate: true, emailStatus: true } },
    },
  },
};

function isUniqueViolation(error) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * A quotation is eligible when it was submitted against a live RFQ. Draft and
 * cancelled RFQs are rejected: there is nothing a manager could approve.
 */
function eligibilityReason(rfq) {
  if (rfq.status === "draft") return "This RFQ has not been published yet.";
  if (rfq.status === "cancelled") return "This RFQ was cancelled.";
  return null;
}

function approvalActions(approval, user, purchaseOrder) {
  const isRequester = approval.requesterId === user.id;
  return {
    canDecide:
      DECIDE_ROLES.includes(user.role) && approval.status === "pending" && !isRequester,
    canGeneratePurchaseOrder:
      REQUEST_ROLES.includes(user.role) && approval.status === "approved" && !purchaseOrder,
    isRequester,
  };
}

function detailPayload(approval, user) {
  const { quotation, rfq, ...rest } = approval;
  return {
    approval: {
      ...approvalOut(approval, { includeTimeline: true, purchaseOrder: undefined }),
      actions: approvalActions(approval, user, approval.purchaseOrder),
    },
    quotation: quotationOut(quotation),
    rfq: {
      ...rfqSummaryOut(rfq),
      items: (rfq.items ?? []).map(rfqItemOut),
    },
    purchaseOrder: approval.purchaseOrder ? purchaseOrderOut(approval.purchaseOrder) : null,
  };
}

// ---------------------------------------------------------------------------
// Listing / queue
// ---------------------------------------------------------------------------

router.get("/", async (req, res) => {
  const query = parse(listQuerySchema, req.query);

  const where = {};
  if (query.status !== "all") where.status = query.status;
  if (query.search) {
    where.OR = [
      { rfq: { reference: { contains: query.search, mode: "insensitive" } } },
      { rfq: { title: { contains: query.search, mode: "insensitive" } } },
      { quotation: { vendor: { name: { contains: query.search, mode: "insensitive" } } } },
      { quotation: { vendor: { code: { contains: query.search, mode: "insensitive" } } } },
    ];
  }

  const orderBy =
    query.sort === "requested_asc" ? [{ requestedAt: "asc" }, { id: "asc" }] : [{ requestedAt: "desc" }, { id: "desc" }];

  const [rows, total, statusRows] = await Promise.all([
    prisma.approvalRequest.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: listInclude,
    }),
    prisma.approvalRequest.count({ where }),
    prisma.approvalRequest.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const statusCounts = Object.fromEntries(APPROVAL_STATUSES.map((status) => [status, 0]));
  for (const row of statusRows) {
    if (Object.hasOwn(statusCounts, row.status)) statusCounts[row.status] = row._count._all;
  }

  res.json({
    items: rows.map((row) => ({
      ...approvalOut(row, { purchaseOrder: row.purchaseOrder }),
      actions: approvalActions(row, req.user, row.purchaseOrder),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    statusCounts,
  });
});

/** The approver queue: pending requests only, newest first. */
router.get("/queue", async (req, res) => {
  const rows = await prisma.approvalRequest.findMany({
    where: { status: "pending" },
    orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
    take: 100,
    include: listInclude,
  });
  res.json({
    items: rows.map((row) => ({
      ...approvalOut(row),
      actions: approvalActions(row, req.user, row.purchaseOrder ?? null),
    })),
    total: rows.length,
  });
});

// ---------------------------------------------------------------------------
// Request / review / decide
// ---------------------------------------------------------------------------

router.post("/", requireRole(...REQUEST_ROLES), async (req, res) => {
  const data = parse(requestSchema, req.body);
  const timestamp = now();

  const created = await prisma.$transaction(
    async (tx) => {
      // Serialise with the vendor's revise path (which locks the same row), so a
      // quotation cannot be edited between the snapshot and the insert.
      await lockRow(tx, "quotations", data.quotationId);

      const quotation = await tx.quotation.findUnique({
        where: { id: data.quotationId },
        include: {
          items: { orderBy: { id: "asc" } },
          vendor: { select: { id: true, name: true, code: true } },
          rfq: { include: { items: { orderBy: { position: "asc" } } } },
        },
      });
      if (!quotation) throw new ApiError(404, "Quotation not found.", { code: "not_found" });

      const blocked = eligibilityReason(quotation.rfq);
      if (blocked) {
        throw new ApiError(409, blocked, { code: "quotation_not_eligible" });
      }

      const issues = quotationIssues(quotation, quotation.rfq);
      if (issues.length > 0) {
        throw new ApiError(409, "This quotation is not internally consistent and cannot be submitted for approval.", {
          code: "quotation_inconsistent",
          fields: { quotationId: issues[0] },
        });
      }

      const existing = await tx.approvalRequest.findUnique({
        where: { quotationId: quotation.id },
        select: { id: true, status: true },
      });
      if (existing) {
        throw new ApiError(409, `This quotation already has an approval request (${existing.status}).`, {
          code: "duplicate_approval",
          fields: { quotationId: "A quotation can only be reviewed once." },
        });
      }

      const active = await tx.approvalRequest.findFirst({
        where: { rfqId: quotation.rfqId, status: { in: ["pending", "approved"] } },
        select: { id: true, status: true },
      });
      if (active) {
        throw new ApiError(
          409,
          active.status === "approved"
            ? "This RFQ already has an approved quotation. Only one quotation per RFQ can be approved."
            : "Another quotation for this RFQ is already awaiting a decision.",
          { code: "active_approval_exists" },
        );
      }

      const snapshot = buildQuotationSnapshot(quotation, quotation.rfq);

      const approval = await tx.approvalRequest.create({
        data: {
          rfqId: quotation.rfqId,
          quotationId: quotation.id,
          quotationRevision: quotation.revision,
          requesterId: req.user.id,
          status: "pending",
          requestRemarks: data.remarks || null,
          requestedAt: timestamp,
          snapshot,
          events: {
            create: {
              actorId: req.user.id,
              type: "requested",
              remarks: data.remarks || null,
              createdAt: timestamp,
            },
          },
        },
      });
      return approval;
    },
    { maxWait: 10000, timeout: 20000 },
  ).catch((error) => {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "Another approval request was created for this RFQ at the same time.", {
        code: "active_approval_exists",
      });
    }
    throw error;
  });

  // The dashboard's "pending approvals" tile moves with every request.
  await invalidateCache("dashboard");

  const full = await prisma.approvalRequest.findUnique({ where: { id: created.id }, include: detailInclude });
  res.status(201).json(detailPayload(full, req.user));
});

async function decide(req, res, decision) {
  const id = approvalId(req.params.id);
  const schema = decision === "rejected" ? rejectionSchema : decisionSchema;
  const data = parse(schema, req.body);
  const timestamp = now();

  const updated = await prisma.$transaction(
    async (tx) => {
      await lockRow(tx, "approval_requests", id);

      const approval = await tx.approvalRequest.findUnique({
        where: { id },
        include: {
          quotation: { include: { items: true } },
          rfq: { include: { items: true } },
        },
      });
      if (!approval) throw new ApiError(404, "Approval request not found.", { code: "not_found" });

      if (approval.status !== "pending") {
        throw new ApiError(409, `This request was already ${approval.status}.`, {
          code: "invalid_transition",
          fields: { status: "A decision is final; the request cannot be decided twice." },
        });
      }
      if (approval.requesterId === req.user.id) {
        throw new ApiError(403, "You cannot decide on an approval you requested yourself.", {
          code: "self_approval_forbidden",
        });
      }

      const issues = [
        ...quotationIssues(approval.quotation, approval.rfq),
        ...snapshotIssues(approval.snapshot, approval.quotation, approval.rfq),
      ];
      if (issues.length > 0) {
        throw new ApiError(409, issues[0], { code: "quotation_changed" });
      }

      const result = await tx.approvalRequest.updateMany({
        where: { id, status: "pending" },
        data: {
          status: decision,
          approverId: req.user.id,
          decidedAt: timestamp,
          decisionRemarks: data.remarks || null,
        },
      });
      if (result.count !== 1) {
        throw new ApiError(409, "This request was decided by another manager. Reload to see the outcome.", {
          code: "invalid_transition",
        });
      }

      await tx.approvalEvent.create({
        data: {
          approvalId: id,
          actorId: req.user.id,
          type: decision,
          remarks: data.remarks || null,
          createdAt: timestamp,
        },
      });

      return tx.approvalRequest.findUnique({ where: { id }, include: detailInclude });
    },
    { maxWait: 10000, timeout: 20000 },
  );

  await invalidateCache("dashboard");
  res.json(detailPayload(updated, req.user));
}

router.post("/:id/approve", requireRole(...DECIDE_ROLES), (req, res) => decide(req, res, "approved"));
router.post("/:id/reject", requireRole(...DECIDE_ROLES), (req, res) => decide(req, res, "rejected"));

router.get("/:id", async (req, res) => {
  const id = approvalId(req.params.id);
  const approval = await prisma.approvalRequest.findUnique({ where: { id }, include: detailInclude });
  if (!approval) throw new ApiError(404, "Approval request not found.", { code: "not_found" });
  res.json(detailPayload(approval, req.user));
});

export default router;
