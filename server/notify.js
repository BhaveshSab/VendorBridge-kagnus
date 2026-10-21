import { prisma } from "./db.js";

/**
 * Week 4 — notifications.
 *
 * Every write below is best-effort: a notification is a convenience view of an
 * action that has already committed, so a failure to insert one must never make
 * the business action fail. The error is logged instead (the audit trail remains
 * the authoritative record of what happened).
 */

function linkFor(entityType, entityId) {
  if (!entityId) return null;
  switch (entityType) {
    case "rfq":
      return `/rfqs/${entityId}`;
    case "approval":
      return `/approvals/${entityId}`;
    case "purchase_order":
      return `/purchase-orders/${entityId}`;
    case "invoice":
      return `/invoices/${entityId}`;
    default:
      return null;
  }
}

export function notificationOut(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    entityType: row.entityType,
    entityId: row.entityId,
    link: row.link ?? linkFor(row.entityType, row.entityId),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function insert(rows) {
  if (rows.length === 0) return 0;
  try {
    const result = await prisma.notification.createMany({ data: rows });
    return result.count;
  } catch (error) {
    console.error(`[notify] could not write ${rows.length} notification(s):`, error?.message || error);
    return 0;
  }
}

/**
 * Creates one notification per unique recipient, excluding the actor. Passing
 * the same user twice (for example a manager who also requested the approval)
 * never creates a duplicate row.
 */
export async function notifyUsers(userIds, payload, { actorId = null } = {}) {
  const unique = [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))].filter(
    (id) => id !== actorId,
  );
  return insert(
    unique.map((userId) => ({
      userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      entityType: payload.entityType ?? null,
      entityId: payload.entityId == null ? null : String(payload.entityId),
      link: payload.link ?? linkFor(payload.entityType, payload.entityId),
      vendorId: payload.vendorId ?? null,
    })),
  );
}

export async function notifyUser(userId, payload, options = {}) {
  return notifyUsers([userId], payload, options);
}

/** Admins and managers who review approval requests. */
export async function notifyReviewers(payload, { actorId = null } = {}) {
  const reviewers = await prisma.user.findMany({
    where: { role: { in: ["admin", "manager"] } },
    select: { id: true },
  });
  return notifyUsers(reviewers.map((row) => row.id), payload, { actorId });
}

/** The account user attached to a vendor, if the vendor has one. */
export async function vendorUserId(vendorId) {
  if (!vendorId) return null;
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { userId: true } });
  return vendor?.userId ?? null;
}

/**
 * Notifies every assigned vendor that has a user account. Vendors without an
 * account (records imported by procurement) simply have no bell to notify.
 */
export async function notifyRfqVendors(rfqId, payload, { actorId = null } = {}) {
  const assignments = await prisma.rfqAssignment.findMany({
    where: { rfqId },
    select: { vendorId: true, vendor: { select: { userId: true } } },
  });
  const rows = assignments
    .filter((row) => row.vendor?.userId && row.vendor.userId !== actorId)
    .map((row) => ({
      userId: row.vendor.userId,
      vendorId: row.vendorId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      entityType: payload.entityType ?? "rfq",
      entityId: String(payload.entityId ?? rfqId),
      link: payload.link ?? linkFor(payload.entityType ?? "rfq", payload.entityId ?? rfqId),
    }));
  return insert(rows);
}

/** The staff member who created the RFQ, when they did not perform the action. */
export async function notifyRfqCreator(rfqId, payload, { actorId = null } = {}) {
  const rfq = await prisma.rfq.findUnique({ where: { id: rfqId }, select: { createdBy: true } });
  if (!rfq?.createdBy) return 0;
  return notifyUser(rfq.createdBy, payload, { actorId });
}

