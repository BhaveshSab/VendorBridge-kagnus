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
  status: "submitted" | "superseded";
  supersedesId: number | null;
  supersededAt: string | null;
  submittedAt: string;
  updatedAt: string;
  items: QuotationLine[];
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
