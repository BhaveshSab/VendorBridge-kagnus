import { prisma } from "./db.js";

/**
 * Week 4 — audit trail.
 *
 * Every state-changing action calls `recordAudit` with what changed and who
 * changed it. Rows are append-only at the database level (triggers reject
 * UPDATE/DELETE), and the actor's name/email/role are copied into the row so
 * the history survives an account being deleted.
 *
 * `strict` defaults to true, so an audit write inside a business transaction
 * fails the transaction rather than letting a change happen unrecorded. Auth
 * events pass `strict: false`: a sign-in must not fail because the audit insert
 * hiccuped, and those events are still logged to the process log if it does.
 */

const ACTIONS = {
  "auth.login": { label: "Signed in", category: "auth" },
  "auth.login_failed": { label: "Failed sign-in", category: "auth" },
  "auth.password_reset": { label: "Password reset", category: "auth" },
  "vendor.created": { label: "Vendor created", category: "vendor" },
  "vendor.updated": { label: "Vendor updated", category: "vendor" },
  "vendor.deleted": { label: "Vendor deleted", category: "vendor" },
  "rfq.created": { label: "RFQ created", category: "rfq" },
  "rfq.updated": { label: "RFQ updated", category: "rfq" },
  "rfq.vendors_updated": { label: "RFQ suppliers assigned", category: "rfq" },
  "rfq.published": { label: "RFQ published", category: "rfq" },
  "rfq.closed": { label: "RFQ closed", category: "rfq" },
  "rfq.cancelled": { label: "RFQ cancelled", category: "rfq" },
  "quotation.submitted": { label: "Quotation submitted", category: "quotation" },
  "quotation.revised": { label: "Quotation revised", category: "quotation" },
  "approval.requested": { label: "Approval requested", category: "approval" },
  "approval.approved": { label: "Approval granted", category: "approval" },
  "approval.rejected": { label: "Approval rejected", category: "approval" },
  "purchase_order.generated": { label: "Purchase order generated", category: "purchase_order" },
  "purchase_order.cancelled": { label: "Purchase order cancelled", category: "purchase_order" },
  "invoice.generated": { label: "Invoice generated", category: "invoice" },
  "invoice.email_sent": { label: "Invoice emailed", category: "invoice" },
  "invoice.email_failed": { label: "Invoice email failed", category: "invoice" },
  "invoice.email_not_configured": { label: "Invoice email not configured", category: "invoice" },
};

export const ENTITY_TYPES = [
  "session",
  "vendor",
  "rfq",
  "quotation",
  "approval",
  "purchase_order",
  "invoice",
];

export const STAFF_ROLES = ["admin", "procurement", "manager"];

export function actionLabel(action) {
  if (ACTIONS[action]) return ACTIONS[action].label;
  return String(action || "unknown")
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function actionCategory(action) {
  return ACTIONS[action]?.category || String(action || "").split(".")[0] || "other";
}

export function auditCatalog() {
  return Object.entries(ACTIONS).map(([value, entry]) => ({
    value,
    label: entry.label,
    category: entry.category,
  }));
}

export function clientAddress(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  const address = forwarded || req.ip || req.socket?.remoteAddress || "";
  return address ? address.slice(0, 64) : null;
}

export function auditActor(req, fallback = null) {
  if (req?.user) {
    return {
      actorId: req.user.id,
      actorName: req.user.name || `${req.user.firstName ?? ""} ${req.user.lastName ?? ""}`.trim() || "Unknown user",
      actorEmail: req.user.email || null,
      actorRole: req.user.role || "unknown",
    };
  }
  if (fallback) return fallback;
  return { actorId: null, actorName: "Anonymous", actorEmail: null, actorRole: "anonymous" };
}

/**
 * Write one audit entry.
 *
 * `client` lets a caller pass its Prisma transaction so the entry commits (or
 * rolls back) with the change it describes.
 */
export async function recordAudit(
  req,
  { action, entityType, entityId = null, summary, metadata = null },
  { client = prisma, strict = true, actor = null } = {},
) {
  const entry = {
    ...auditActor(req, actor),
    action,
    entityType,
    entityId: entityId == null ? null : String(entityId),
    summary: String(summary || "").slice(0, 500),
    metadata: metadata ?? undefined,
    ipAddress: clientAddress(req),
    userAgent: req?.headers?.["user-agent"] ? String(req.headers["user-agent"]).slice(0, 200) : null,
    createdAt: new Date(),
  };

  if (strict) return client.auditLog.create({ data: entry });

  try {
    return await client.auditLog.create({ data: entry });
  } catch (error) {
    console.error(`[audit] could not record ${action}:`, error?.message || error);
    return null;
  }
}

export function auditOut(row) {
  return {
    id: row.id,
    action: row.action,
    actionLabel: actionLabel(row.action),
    category: actionCategory(row.action),
    actor: {
      id: row.actorId,
      name: row.actorName,
      email: row.actorEmail,
      role: row.actorRole,
    },
    entityType: row.entityType,
    entityId: row.entityId,
    summary: row.summary,
    metadata: row.metadata ?? null,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}
