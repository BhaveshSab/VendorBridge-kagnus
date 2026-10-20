import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiError, currentVendorFor, parse, requireAuth, requireRole } from "../auth.js";
import { invalidateCache } from "../cache.js";
import { nextSequence, now, prisma } from "../db.js";
import { invoiceEmailProvider, sendInvoiceEmail } from "../email.js";
import { renderInvoicePdf } from "../pdf.js";
import { invoiceOut } from "../serializers.js";
import {
  documentIssues,
  documentNumber,
  lockRow,
  safeErrorText,
} from "../workflow.js";

const router = Router();
router.use(requireAuth, requireRole("admin", "procurement", "manager", "vendor"));

const STAFF_ROLES = ["admin", "procurement", "manager"];
const GENERATE_ROLES = ["admin", "procurement"];
const DUE_DATE_MAX_DAYS = 365;

const listQuerySchema = z.object({
  status: z.enum(["all", "issued"]).optional().default("all"),
  emailStatus: z.enum(["all", "not_sent", "sent", "failed", "not_configured"]).optional().default("all"),
  search: z.string().trim().max(120).optional().default(""),
  sort: z.enum(["issued_desc", "issued_asc"]).optional().default("issued_desc"),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
});

const generateSchema = z.object({
  purchaseOrderId: z.coerce.number().int().positive("Choose a purchase order to invoice."),
  dueDate: z.string().trim().max(40).optional().default(""),
});

const invoiceInclude = {
  rfq: { select: { id: true, reference: true, title: true } },
  vendor: true,
  purchaseOrder: {
    include: {
      quotation: { select: { id: true, revision: true } },
      approvalRequest: {
        include: { approver: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  },
  creator: { select: { id: true, firstName: true, lastName: true } },
  items: { orderBy: { position: "asc" } },
  events: {
    orderBy: { createdAt: "asc" },
    include: { actor: { select: { id: true, firstName: true, lastName: true } } },
  },
};

/**
 * The list view renders invoice headers only — `invoiceOut` is called with
 * `includeTimeline: false` — so the list query deliberately skips the event
 * timeline and the purchase order's approval chain. Each of those is a separate
 * relation load, and on a remote database that is three round trips of data
 * fetched only to be discarded.
 */
const invoiceListInclude = {
  rfq: { select: { id: true, reference: true, title: true } },
  vendor: true,
  purchaseOrder: {
    select: {
      id: true,
      number: true,
      status: true,
      issuedAt: true,
      quotation: { select: { id: true, revision: true } },
    },
  },
  creator: { select: { id: true, firstName: true, lastName: true } },
  items: { orderBy: { position: "asc" } },
};

/**
 * Invoice dates are calendar dates, not instants. The server's local day is the
 * day the document is issued, and it is stored as UTC midnight so the same
 * date string is returned to every client and rendered in the PDF.
 */
function issueDateFor(date) {
  const pad = (part) => String(part).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return new Date(`${day}T00:00:00.000Z`);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86_400_000);
}

function isUniqueViolation(error) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const invoiceId = (raw) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(404, "Invoice not found.", { code: "not_found" });
  }
  return id;
};

async function vendorScope(req) {
  const vendor = await currentVendorFor(req.user);
  if (!vendor) {
    throw new ApiError(403, "Your account is not linked to a vendor record.", {
      code: "vendor_profile_missing",
    });
  }
  return vendor;
}

async function loadInvoice(req, id) {
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: invoiceInclude });
  if (!invoice) throw new ApiError(404, "Invoice not found.", { code: "not_found" });

  const isStaff = STAFF_ROLES.includes(req.user.role);
  if (!isStaff) {
    const vendor = await vendorScope(req);
    if (invoice.vendorId !== vendor.id) {
      throw new ApiError(404, "Invoice not found.", { code: "not_found" });
    }
  }
  return { invoice, isStaff };
}

/** Date-only due dates arrive as YYYY-MM-DD; anything else must be a real date. */
function parseDueDate(raw, issueDate) {
  if (!raw) return null;
  const value = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) {
    throw new ApiError(422, "Enter a valid due date.", {
      code: "validation_failed",
      fields: { dueDate: "Enter a valid date." },
    });
  }
  if (due.getTime() < issueDate.getTime()) {
    throw new ApiError(422, "The due date cannot be before the issue date.", {
      code: "validation_failed",
      fields: { dueDate: "Choose today or a later date." },
    });
  }
  if (due.getTime() > addDays(issueDate, DUE_DATE_MAX_DAYS).getTime()) {
    throw new ApiError(422, `The due date cannot be more than ${DUE_DATE_MAX_DAYS} days after the issue date.`, {
      code: "validation_failed",
      fields: { dueDate: "Choose a date within a year." },
    });
  }
  return due;
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
  if (query.emailStatus !== "all") where.emailStatus = query.emailStatus;
  if (query.search) {
    where.OR = [
      { number: { contains: query.search, mode: "insensitive" } },
      { purchaseOrder: { number: { contains: query.search, mode: "insensitive" } } },
      { rfq: { reference: { contains: query.search, mode: "insensitive" } } },
      ...(isStaff ? [{ vendor: { name: { contains: query.search, mode: "insensitive" } } }] : []),
    ];
  }

  const orderBy =
    query.sort === "issued_asc" ? [{ issueDate: "asc" }, { id: "asc" }] : [{ issueDate: "desc" }, { id: "desc" }];

  const [rows, total, emailRows] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: invoiceListInclude,
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.groupBy({
      by: ["emailStatus"],
      where: isStaff ? {} : { vendorId: where.vendorId },
      _count: { _all: true },
    }),
  ]);

  res.json({
    items: rows.map((row) => invoiceOut(row, { revealInternal: isStaff, includeTimeline: false })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    emailStatusCounts: Object.fromEntries(emailRows.map((row) => [row.emailStatus, row._count._all])),
  });
});

// ---------------------------------------------------------------------------
// Generation from a purchase order
// ---------------------------------------------------------------------------

router.post("/", requireRole(...GENERATE_ROLES), async (req, res) => {
  const data = parse(generateSchema, req.body);
  const timestamp = now();
  const issueDate = issueDateFor(timestamp);
  const dueDate = parseDueDate(data.dueDate, issueDate);

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await lockRow(tx, "purchase_orders", data.purchaseOrderId);

        const purchaseOrder = await tx.purchaseOrder.findUnique({
          where: { id: data.purchaseOrderId },
          include: {
            items: { orderBy: { position: "asc" } },
            vendor: true,
            rfq: { select: { id: true, reference: true, currency: true } },
            invoices: { select: { id: true } },
          },
        });
        if (!purchaseOrder) throw new ApiError(404, "Purchase order not found.", { code: "not_found" });

        if (purchaseOrder.status !== "issued") {
          throw new ApiError(409, "A cancelled purchase order cannot be invoiced.", { code: "invalid_transition" });
        }
        if (purchaseOrder.invoices.length > 0) {
          return { invoiceId: purchaseOrder.invoices[0].id, created: false };
        }

        const issues = documentIssues({
          items: purchaseOrder.items,
          taxPercent: purchaseOrder.taxPercent,
          subtotal: purchaseOrder.subtotal,
          taxAmount: purchaseOrder.taxAmount,
          shippingAmount: purchaseOrder.shippingAmount,
          total: purchaseOrder.total,
          currency: purchaseOrder.currency,
          rfqCurrency: purchaseOrder.rfq.currency,
        });
        if (issues.length > 0) {
          throw new ApiError(409, "The purchase order totals are inconsistent and cannot be invoiced.", {
            code: "document_inconsistent",
            fields: { purchaseOrderId: issues[0] },
          });
        }

        const seq = await nextSequence("INV", tx);
        const invoice = await tx.invoice.create({
          data: {
            number: documentNumber("INV", seq),
            purchaseOrderId: purchaseOrder.id,
            rfqId: purchaseOrder.rfqId,
            vendorId: purchaseOrder.vendorId,
            createdBy: req.user.id,
            currency: purchaseOrder.currency,
            // The invoice carries the approved tax and delivery charges. Nothing
            // is recomputed here, so tax cannot be applied twice.
            taxPercent: purchaseOrder.taxPercent,
            subtotal: purchaseOrder.subtotal,
            taxAmount: purchaseOrder.taxAmount,
            shippingAmount: purchaseOrder.shippingAmount,
            total: purchaseOrder.total,
            status: "issued",
            issueDate,
            dueDate,
            emailStatus: "not_sent",
            emailAttempts: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
            items: {
              create: purchaseOrder.items.map((line) => ({
                position: line.position,
                description: line.description,
                quantity: line.quantity,
                unit: line.unit,
                unitPrice: line.unitPrice,
                lineTotal: line.lineTotal,
              })),
            },
            events: {
              create: {
                actorId: req.user.id,
                type: "generated",
                detail: `Generated from purchase order ${purchaseOrder.number}.`,
                createdAt: timestamp,
              },
            },
          },
          include: invoiceInclude,
        });

        return { invoiceId: invoice.id, created: true };
      },
      { maxWait: 10000, timeout: 20000 },
    );

    if (result.created) await invalidateCache("dashboard");

    const invoice = await prisma.invoice.findUnique({ where: { id: result.invoiceId }, include: invoiceInclude });
    res.status(result.created ? 201 : 200).json({
      invoice: invoiceOut(invoice, { revealInternal: true }),
      created: result.created,
      message: result.created ? `${invoice.number} generated from ${invoice.purchaseOrder.number}.` : `${invoice.number} already exists for this purchase order.`,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await prisma.invoice.findUnique({
        where: { purchaseOrderId: data.purchaseOrderId },
        include: invoiceInclude,
      });
      if (existing) {
        res.status(200).json({
          invoice: invoiceOut(existing, { revealInternal: true }),
          created: false,
          message: `${existing.number} already exists for this purchase order.`,
        });
        return;
      }
    }
    throw error;
  }
});

// ---------------------------------------------------------------------------
// Detail, PDF and delivery
// ---------------------------------------------------------------------------

router.get("/:id", async (req, res) => {
  const { invoice, isStaff } = await loadInvoice(req, invoiceId(req.params.id));
  res.json({
    invoice: invoiceOut(invoice, { revealInternal: isStaff }),
    actions: {
      canSend: GENERATE_ROLES.includes(req.user.role) && invoice.purchaseOrder.status === "issued",
      canDownload: true,
      emailConfigured: invoiceEmailProvider() !== null,
    },
  });
});

router.get("/:id/pdf", async (req, res) => {
  const { invoice } = await loadInvoice(req, invoiceId(req.params.id));
  const bytes = await renderInvoicePdf(invoice, { generatedAt: new Date() });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${invoice.number}.pdf"`);
  res.setHeader("Content-Length", String(bytes.length));
  res.send(Buffer.from(bytes));
});

router.post("/:id/send", requireRole(...GENERATE_ROLES), async (req, res) => {
  const id = invoiceId(req.params.id);
  const { invoice } = await loadInvoice(req, id);

  if (invoice.purchaseOrder.status !== "issued") {
    throw new ApiError(409, "A cancelled purchase order cannot have its invoice sent.", {
      code: "invalid_transition",
    });
  }

  // Always the vendor record's stored address: the request body cannot redirect
  // an invoice to another recipient.
  const to = invoice.vendor.email;
  const provider = invoiceEmailProvider();
  const timestamp = now();

  if (!provider) {
    await prisma.$transaction([
      prisma.invoice.update({
        where: { id },
        data: { emailStatus: "not_configured", emailError: null, updatedAt: timestamp },
      }),
      prisma.invoiceEvent.create({
        data: {
          invoiceId: id,
          actorId: req.user.id,
          type: "email_not_configured",
          detail: "No email provider is configured; the invoice was not sent.",
          createdAt: timestamp,
        },
      }),
    ]);
    throw new ApiError(503, `Email delivery is not configured, so ${invoice.number} was not sent.`, {
      code: "email_not_configured",
    });
  }

  const pdfBytes = await renderInvoicePdf(invoice, { generatedAt: new Date() });
  let delivery;
  try {
    delivery = await sendInvoiceEmail({
      to,
      invoice,
      pdfBytes,
      vendorName: invoice.vendor?.contactName || invoice.vendor?.name || null,
    });
  } catch (error) {
    delivery = { status: "failed", provider, error: safeErrorText(error) };
  }

  if (delivery.status === "sent") {
    await prisma.$transaction([
      prisma.invoice.update({
        where: { id },
        data: {
          emailStatus: "sent",
          emailProvider: delivery.provider,
          emailSentAt: timestamp,
          emailError: null,
          emailAttempts: { increment: 1 },
          updatedAt: timestamp,
        },
      }),
      prisma.invoiceEvent.create({
        data: {
          invoiceId: id,
          actorId: req.user.id,
          type: "email_sent",
          detail: `Sent to the vendor address on file (${delivery.provider}).`,
          createdAt: timestamp,
        },
      }),
    ]);
  } else {
    const errorText = safeErrorText(delivery.error || "The provider rejected the message.");
    await prisma.$transaction([
      prisma.invoice.update({
        where: { id },
        data: {
          emailStatus: "failed",
          emailProvider: delivery.provider ?? provider,
          emailError: errorText,
          emailAttempts: { increment: 1 },
          updatedAt: timestamp,
        },
      }),
      prisma.invoiceEvent.create({
        data: {
          invoiceId: id,
          actorId: req.user.id,
          type: "email_failed",
          detail: "The provider could not deliver the invoice email.",
          createdAt: timestamp,
        },
      }),
    ]);
    throw new ApiError(502, `The invoice email could not be delivered. ${errorText}`, {
      code: "email_failed",
    });
  }

  const updated = await prisma.invoice.findUnique({ where: { id }, include: invoiceInclude });
  res.json({
    invoice: invoiceOut(updated, { revealInternal: true }),
    delivery: { status: "sent", provider: delivery.provider, sentAt: timestamp.toISOString() },
  });
});

export default router;
