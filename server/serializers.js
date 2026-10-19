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
