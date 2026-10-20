export type Role = "admin" | "procurement" | "manager" | "vendor";

export interface User {
  id: number;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string | null;
  country: string | null;
  role: Role;
  additionalInfo: string | null;
  createdAt: string;
}

export interface Permissions {
  manageVendors: boolean;
  manageRfqs: boolean;
  viewQuotations: boolean;
  submitQuotations: boolean;
}

export interface Session {
  user: User;
  vendor: Vendor | null;
  permissions: Permissions;
  roleLabel: string;
}

export type RfqStatus = "draft" | "open" | "closed" | "cancelled";
export type RfqEffectiveStatus = RfqStatus | "expired";

export interface RfqItem {
  id: number;
  position: number;
  description: string;
  quantity: string;
  unit: string;
  specifications: string | null;
}

export interface RfqAssignment {
  id: number;
  vendorId: number;
  vendorName: string | null;
  vendorCode: string | null;
  vendorStatus: string | null;
  assignedAt: string;
}

export interface RfqSubmission {
  vendorId: number;
  vendorName: string | null;
  vendorCode: string | null;
  status: "submitted" | "awaiting";
  quotationId: number | null;
  total: string | null;
  submittedAt: string | null;
  revision: number | null;
}

export interface RfqSummary {
  id: number;
  reference: string;
  title: string;
  currency: string;
  status: RfqStatus;
  effectiveStatus: RfqEffectiveStatus;
  deadline: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  creatorName: string | null;
  itemCount: number;
  vendorCount: number;
  quotationCount: number;
  hasSubmitted?: boolean;
  myQuotation?: { id: number; total: string; submittedAt: string; revision: number } | null;
}

export interface RfqDetail extends RfqSummary {
  description: string | null;
  items: RfqItem[];
  assignments?: RfqAssignment[];
  submissions?: RfqSubmission[];
}

export interface QuotationLine {
  id: number;
  rfqItemId: number;
  unitPrice: string;
  lineTotal: string;
}

export interface Quotation {
  id: number;
  rfqId: number;
  vendorId: number;
  vendorName?: string | null;
  vendorCode?: string | null;
  currency: string;
  deliveryDays: number;
  deliveryTerms: string | null;
  notes: string | null;
  taxPercent: string;
  subtotal: string;
  taxAmount: string;
  shippingAmount: string;
  total: string;
  revision: number;
  submittedAt: string;
  updatedAt: string;
  items: QuotationLine[];
  approval?: { id: number; status: ApprovalStatus } | null;
}

export interface RfqSubmissionState {
  canSubmit: boolean;
  reason: string | null;
}

export interface RfqDetailResponse {
  rfq: RfqDetail;
  myQuotation: Quotation | null;
  submission: RfqSubmissionState | null;
}

export interface RfqListResponse {
  items: RfqSummary[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
}

export interface RfqQuotationsResponse {
  rfq: RfqSummary;
  items: RfqItem[];
  quotations: Quotation[];
  summary: { count: number };
}

export interface ComparisonQuotation extends Quotation {
  compatible: boolean;
  exclusionReasons: string[];
  isLowest: boolean;
  calculatedLines: { rfqItemId: number; unitPrice: string; lineTotal: string }[];
}

export interface RfqComparisonResponse {
  rfq: RfqSummary;
  items: RfqItem[];
  basis: {
    currency: string;
    includesTax: boolean;
    includesShipping: boolean;
    comparisonField: string;
    totalDefinition: string;
  };
  summary: {
    quotationCount: number;
    comparableCount: number;
    excludedCount: number;
    lowestTotal: string | null;
    canCompare: boolean;
  };
  lowest: {
    quotationId: number;
    vendorId: number;
    vendorName: string | null;
    vendorCode: string | null;
    total: string;
    deliveryDays: number;
    submittedAt: string;
  } | null;
  quotations: ComparisonQuotation[];
  excluded: { quotationId: number; vendorId: number; vendorName: string | null; reasons: string[] }[];
}

export interface Vendor {
  id: number;
  code: string;
  name: string;
  category: string;
  gstin: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  contactName: string | null;
  status: "Active" | "Pending" | "Inactive" | "Blocked";
  rating: number;
  notes: string | null;
  userId: number | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Week 3 - approval, purchase order and invoice workflow
// ---------------------------------------------------------------------------

export type ApprovalStatus = "pending" | "approved" | "rejected";
export type PurchaseOrderStatus = "issued" | "cancelled";
export type InvoiceEmailStatus = "not_sent" | "sent" | "failed" | "not_configured";

export interface DocumentLine {
  id?: number;
  rfqItemId?: number;
  position: number;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  lineTotal: string;
}

export interface ApprovalEvent {
  id: number;
  type: "requested" | "approved" | "rejected";
  actorId: number | null;
  actorName: string | null;
  remarks: string | null;
  createdAt: string;
}

export interface ApprovalActions {
  canDecide: boolean;
  canGeneratePurchaseOrder: boolean;
  isRequester: boolean;
}

export interface ApprovalSummary {
  id: number;
  status: ApprovalStatus;
  rfqId: number;
  rfqReference: string | null;
  rfqTitle: string | null;
  quotationId: number;
  quotationRevision: number;
  vendorId: number | null;
  vendorName: string | null;
  vendorCode: string | null;
  currency: string | null;
  deliveryDays: number | null;
  deliveryTerms: string | null;
  taxPercent: string | null;
  subtotal: string | null;
  taxAmount: string | null;
  shippingAmount: string | null;
  total: string | null;
  items: DocumentLine[];
  requestedAt: string;
  requesterId: number | null;
  requesterName: string | null;
  approverId: number | null;
  approverName: string | null;
  decidedAt: string | null;
  requestRemarks: string | null;
  decisionRemarks: string | null;
  timeline?: ApprovalEvent[];
  purchaseOrder?: { id: number; number: string; status: string } | null;
  actions?: ApprovalActions;
}

export interface ApprovalDetailResponse {
  approval: ApprovalSummary & { actions: ApprovalActions };
  quotation: Quotation;
  rfq: RfqSummary & { items: RfqItem[] };
  purchaseOrder: PurchaseOrder | null;
}

export interface ApprovalListResponse {
  items: ApprovalSummary[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
}

export interface PurchaseOrder {
  id: number;
  number: string;
  status: PurchaseOrderStatus;
  currency: string;
  taxPercent: string;
  subtotal: string;
  taxAmount: string;
  shippingAmount: string;
  total: string;
  issuedAt: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  rfq: { id: number; reference: string | null; title: string | null };
  vendor: { id: number; name: string | null; code: string | null; email?: string | null };
  quotationId: number;
  quotationRevision: number | null;
  approval: { id: number; status: ApprovalStatus; decidedAt: string | null; decidedBy: string | null } | null;
  createdBy: string | null;
  items: DocumentLine[];
  invoice?: InvoiceSummary | null;
}

export interface PurchaseOrderResponse {
  purchaseOrder: PurchaseOrder;
  created?: boolean;
  message?: string;
  actions?: { canGenerateInvoice: boolean; canCancel: boolean };
}

export interface PurchaseOrderListResponse {
  items: PurchaseOrder[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
}

export interface InvoiceSummary {
  id: number;
  number: string;
  status: string;
  total: string;
  currency: string;
  issueDate: string;
  dueDate: string | null;
  emailStatus: InvoiceEmailStatus;
}

export interface InvoiceEvent {
  id: number;
  type: "generated" | "email_sent" | "email_failed" | "email_not_configured";
  actorId: number | null;
  actorName: string | null;
  detail: string | null;
  createdAt: string;
}

export interface Invoice {
  id: number;
  number: string;
  status: string;
  currency: string;
  taxPercent: string;
  subtotal: string;
  taxAmount: string;
  shippingAmount: string;
  total: string;
  issueDate: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  email: {
    status: InvoiceEmailStatus;
    provider: string | null;
    sentAt: string | null;
    attempts: number;
    error: string | null;
  };
  rfq: { id: number; reference: string | null; title: string | null };
  vendor: { id: number; name: string | null; code: string | null; email?: string | null };
  purchaseOrder: { id: number; number: string; status: PurchaseOrderStatus; issuedAt: string } | null;
  quotationRevision: number | null;
  createdBy: string | null;
  items: DocumentLine[];
  timeline?: InvoiceEvent[];
}

export interface InvoiceDetailResponse {
  invoice: Invoice;
  actions: { canSend: boolean; canDownload: boolean; emailConfigured: boolean };
}

export interface InvoiceListResponse {
  items: Invoice[];
  total: number;
  page: number;
  pageSize: number;
  emailStatusCounts: Record<string, number>;
}
