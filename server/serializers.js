export function roleLabel(role) {
  return (
    {
      admin: "Admin",
      procurement: "Procurement Officer",
      manager: "Manager/Approver",
      vendor: "Vendor",
    }[role] || role
  );
}

export function vendorOut(vendor, { includeInternalNotes = true } = {}) {
  if (!vendor) return null;
  return {
    id: vendor.id,
    code: vendor.code,
    name: vendor.name,
    category: vendor.category,
    gstin: vendor.gstin,
    email: vendor.email,
    phone: vendor.phone,
    address: vendor.address,
    city: vendor.city,
    country: vendor.country,
    contactName: vendor.contactName,
    status: vendor.status,
    rating: vendor.rating,
    notes: includeInternalNotes ? vendor.notes : null,
    userId: vendor.userId,
    createdAt: vendor.createdAt.toISOString(),
    updatedAt: vendor.updatedAt.toISOString(),
  };
}

export const PERMISSIONS = {
  admin: { manageVendors: true, manageRfqs: true, viewQuotations: true, submitQuotations: false },
  procurement: { manageVendors: true, manageRfqs: true, viewQuotations: true, submitQuotations: false },
  manager: { manageVendors: false, manageRfqs: false, viewQuotations: true, submitQuotations: false },
  vendor: { manageVendors: false, manageRfqs: false, viewQuotations: false, submitQuotations: true },
};

// ---------------------------------------------------------------------------
// Week 2 — RFQ and quotation response shapes
// ---------------------------------------------------------------------------

const ISO = (value) => (value ? value.toISOString() : null);
// Document dates are calendar dates stored at UTC midnight; sending the date
// part keeps every client on the same day regardless of its timezone.
const DATE_ONLY = (value) => (value ? value.toISOString().slice(0, 10) : null);

function personName(user) {
  if (!user) return null;
  return `${user.firstName} ${user.lastName}`.trim();
}

/**
 * Drafts become visible to assigned vendors only after publication. An RFQ
 * whose deadline has passed while still open is reported as `expired` — the
 * stored status stays `open` so procurement can still close or review it.
 */
export function effectiveRfqStatus(rfq, at = Date.now()) {
  if (rfq.status === "open" && rfq.deadline.getTime() <= at) return "expired";
  return rfq.status;
}

export function rfqSummaryOut(rfq, extra = {}) {
  return {
    id: rfq.id,
    reference: rfq.reference,
    title: rfq.title,
    currency: rfq.currency,
    status: rfq.status,
    effectiveStatus: effectiveRfqStatus(rfq),
    deadline: ISO(rfq.deadline),
    createdAt: ISO(rfq.createdAt),
    updatedAt: ISO(rfq.updatedAt),
    publishedAt: ISO(rfq.publishedAt),
    closedAt: ISO(rfq.closedAt),
    cancelledAt: ISO(rfq.cancelledAt),
    creatorName: personName(rfq.creator),
    itemCount: rfq._count?.items ?? rfq.items?.length ?? 0,
    vendorCount: rfq._count?.assignments ?? rfq.assignments?.length ?? 0,
    quotationCount: rfq._count?.quotations ?? rfq.quotations?.length ?? 0,
    ...extra,
  };
}

export function rfqItemOut(item) {
  return {
    id: item.id,
    position: item.position,
    description: item.description,
    quantity: item.quantity.toFixed(3).replace(/\.?0+$/, ""),
    unit: item.unit,
    specifications: item.specifications,
  };
}

export function rfqAssignmentOut(assignment) {
  return {
    id: assignment.id,
    vendorId: assignment.vendorId,
    vendorName: assignment.vendor?.name ?? null,
    vendorCode: assignment.vendor?.code ?? null,
    vendorStatus: assignment.vendor?.status ?? null,
    assignedAt: ISO(assignment.assignedAt),
  };
}

export function quotationOut(quotation, { includeVendor = true, revealNotes = true } = {}) {
  if (!quotation) return null;
  return {
    id: quotation.id,
    rfqId: quotation.rfqId,
    vendorId: quotation.vendorId,
    ...(includeVendor
      ? { vendorName: quotation.vendor?.name ?? null, vendorCode: quotation.vendor?.code ?? null }
      : {}),
    currency: quotation.currency,
    deliveryDays: quotation.deliveryDays,
    deliveryTerms: quotation.deliveryTerms,
    notes: revealNotes ? quotation.notes : null,
    taxPercent: quotation.taxPercent.toFixed(2),
    subtotal: quotation.subtotal.toFixed(2),
    taxAmount: quotation.taxAmount.toFixed(2),
    shippingAmount: quotation.shippingAmount.toFixed(2),
    total: quotation.total.toFixed(2),
    revision: quotation.revision,
    status: quotation.status ?? "submitted",
    supersedesId: quotation.supersedesId ?? null,
    supersededAt: ISO(quotation.supersededAt ?? null),
    submittedAt: ISO(quotation.submittedAt),
    updatedAt: ISO(quotation.updatedAt),
    items: (quotation.items ?? []).map((line) => ({
      id: line.id,
      rfqItemId: line.rfqItemId,
      unitPrice: line.unitPrice.toFixed(2),
      lineTotal: line.lineTotal.toFixed(2),
    })),
  };
}

export function rfqSubmissionOut(assignment, quotation) {
  return {
    vendorId: assignment.vendorId,
    vendorName: assignment.vendor?.name ?? null,
    vendorCode: assignment.vendor?.code ?? null,
    status: quotation ? "submitted" : "awaiting",
    quotationId: quotation?.id ?? null,
    total: quotation ? quotation.total.toFixed(2) : null,
    submittedAt: ISO(quotation?.submittedAt ?? null),
    revision: quotation?.revision ?? null,
  };
}

export function rfqDetailOut(rfq, { includeAssignments = true, submissions } = {}) {
  return {
    ...rfqSummaryOut(rfq),
    description: rfq.description,
    items: (rfq.items ?? []).map(rfqItemOut),
    ...(includeAssignments ? { assignments: (rfq.assignments ?? []).map(rfqAssignmentOut) } : {}),
    ...(submissions ? { submissions } : {}),
  };
}

// ---------------------------------------------------------------------------
// Week 3 - approval, purchase order and invoice response shapes
//
// `revealInternal` is false for vendor responses: approval remarks, requester
// and approver identities are internal procurement context and never leave the
// staff surface.
// ---------------------------------------------------------------------------

const qtyOut = (value) => (value == null ? null : value.toFixed(3).replace(/\.?0+$/, ""));

export function approvalEventOut(event) {
  return {
    id: event.id,
    type: event.type,
    actorId: event.actorId ?? null,
    actorName: personName(event.actor),
    remarks: event.remarks ?? null,
    createdAt: ISO(event.createdAt),
  };
}

export function approvalOut(
  approval,
  { revealInternal = true, includeTimeline = false, purchaseOrder = undefined } = {},
) {
  const snapshot = approval.snapshot && typeof approval.snapshot === "object" ? approval.snapshot : {};
  return {
    id: approval.id,
    status: approval.status,
    rfqId: approval.rfqId,
    rfqReference: approval.rfq?.reference ?? snapshot.rfqReference ?? null,
    rfqTitle: approval.rfq?.title ?? snapshot.rfqTitle ?? null,
    quotationId: approval.quotationId,
    quotationRevision: approval.quotationRevision,
    vendorId: snapshot.vendorId ?? null,
    vendorName: snapshot.vendorName ?? null,
    vendorCode: snapshot.vendorCode ?? null,
    currency: snapshot.currency ?? null,
    deliveryDays: snapshot.deliveryDays ?? null,
    deliveryTerms: snapshot.deliveryTerms ?? null,
    taxPercent: snapshot.taxPercent ?? null,
    subtotal: snapshot.subtotal ?? null,
    taxAmount: snapshot.taxAmount ?? null,
    shippingAmount: snapshot.shippingAmount ?? null,
    total: snapshot.total ?? null,
    items: Array.isArray(snapshot.items) ? snapshot.items : [],
    requestedAt: ISO(approval.requestedAt),
    requesterId: revealInternal ? approval.requesterId : null,
    requesterName: revealInternal ? personName(approval.requester) : null,
    approverId: revealInternal ? approval.approverId ?? null : null,
    approverName: revealInternal ? personName(approval.approver) : null,
    decidedAt: ISO(approval.decidedAt),
    requestRemarks: revealInternal ? approval.requestRemarks : null,
    decisionRemarks: revealInternal ? approval.decisionRemarks : null,
    ...(includeTimeline ? { timeline: (approval.events ?? []).map(approvalEventOut) } : {}),
    ...(purchaseOrder !== undefined ? { purchaseOrder } : {}),
  };
}

export function purchaseOrderItemOut(line) {
  return {
    id: line.id,
    position: line.position,
    description: line.description,
    quantity: qtyOut(line.quantity),
    unit: line.unit,
    unitPrice: line.unitPrice.toFixed(2),
    lineTotal: line.lineTotal.toFixed(2),
  };
}

export function invoiceSummaryOut(invoice) {
  if (!invoice) return null;
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    total: invoice.total.toFixed(2),
    currency: invoice.currency,
    issueDate: DATE_ONLY(invoice.issueDate),
    dueDate: DATE_ONLY(invoice.dueDate),
    emailStatus: invoice.emailStatus,
  };
}

export function purchaseOrderOut(po, { revealInternal = true, includeInvoice = true } = {}) {
  if (!po) return null;
  const invoice = includeInvoice ? invoiceSummaryOut((po.invoices ?? [])[0] ?? null) : undefined;
  return {
    id: po.id,
    number: po.number,
    status: po.status,
    currency: po.currency,
    taxPercent: po.taxPercent.toFixed(2),
    subtotal: po.subtotal.toFixed(2),
    taxAmount: po.taxAmount.toFixed(2),
    shippingAmount: po.shippingAmount.toFixed(2),
    total: po.total.toFixed(2),
    issuedAt: ISO(po.issuedAt),
    createdAt: ISO(po.createdAt),
    updatedAt: ISO(po.updatedAt),
    cancelledAt: ISO(po.cancelledAt),
    cancelReason: po.cancelReason ?? null,
    rfq: { id: po.rfq?.id ?? po.rfqId, reference: po.rfq?.reference ?? null, title: po.rfq?.title ?? null },
    vendor: {
      id: po.vendor?.id ?? po.vendorId,
      name: po.vendor?.name ?? null,
      code: po.vendor?.code ?? null,
      ...(revealInternal ? { email: po.vendor?.email ?? null } : {}),
    },
    quotationId: po.quotationId,
    quotationRevision: po.quotation?.revision ?? null,
    approval: po.approvalRequest
      ? {
          id: po.approvalRequest.id,
          status: po.approvalRequest.status,
          decidedAt: ISO(po.approvalRequest.decidedAt),
          decidedBy: revealInternal ? personName(po.approvalRequest.approver) : null,
        }
      : null,
    createdBy: revealInternal ? personName(po.creator) : null,
    items: (po.items ?? []).map(purchaseOrderItemOut),
    ...(invoice !== undefined ? { invoice } : {}),
  };
}

export function invoiceEventOut(event, { revealInternal = true } = {}) {
  return {
    id: event.id,
    type: event.type,
    actorId: revealInternal ? event.actorId ?? null : null,
    actorName: revealInternal ? personName(event.actor) : null,
    detail: event.detail ?? null,
    createdAt: ISO(event.createdAt),
  };
}

export function invoiceOut(invoice, { revealInternal = true, includeTimeline = true } = {}) {
  if (!invoice) return null;
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    currency: invoice.currency,
    taxPercent: invoice.taxPercent.toFixed(2),
    subtotal: invoice.subtotal.toFixed(2),
    taxAmount: invoice.taxAmount.toFixed(2),
    shippingAmount: invoice.shippingAmount.toFixed(2),
    total: invoice.total.toFixed(2),
    issueDate: DATE_ONLY(invoice.issueDate),
    dueDate: DATE_ONLY(invoice.dueDate),
    createdAt: ISO(invoice.createdAt),
    updatedAt: ISO(invoice.updatedAt),
    email: {
      status: invoice.emailStatus,
      provider: invoice.emailProvider ?? null,
      sentAt: ISO(invoice.emailSentAt),
      attempts: invoice.emailAttempts,
      error: revealInternal ? invoice.emailError ?? null : invoice.emailStatus === "failed" ? "The email could not be delivered." : null,
    },
    rfq: { id: invoice.rfq?.id ?? invoice.rfqId, reference: invoice.rfq?.reference ?? null, title: invoice.rfq?.title ?? null },
    vendor: {
      id: invoice.vendor?.id ?? invoice.vendorId,
      name: invoice.vendor?.name ?? null,
      code: invoice.vendor?.code ?? null,
      ...(revealInternal ? { email: invoice.vendor?.email ?? null } : {}),
    },
    purchaseOrder: invoice.purchaseOrder
      ? {
          id: invoice.purchaseOrder.id,
          number: invoice.purchaseOrder.number,
          status: invoice.purchaseOrder.status,
          issuedAt: ISO(invoice.purchaseOrder.issuedAt),
        }
      : null,
    quotationRevision: invoice.purchaseOrder?.quotation?.revision ?? null,
    createdBy: revealInternal ? personName(invoice.creator) : null,
    items: (invoice.items ?? []).map((line) => ({
      id: line.id,
      position: line.position,
      description: line.description,
      quantity: qtyOut(line.quantity),
      unit: line.unit,
      unitPrice: line.unitPrice.toFixed(2),
      lineTotal: line.lineTotal.toFixed(2),
    })),
    ...(includeTimeline ? { timeline: (invoice.events ?? []).map((event) => invoiceEventOut(event, { revealInternal })) } : {}),
  };
}
