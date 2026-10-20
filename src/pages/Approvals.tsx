import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Page } from "../components/guards";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  SearchInput,
  SkeletonBlock,
  Tabs,
  Textarea,
  cn,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { formatDateTime, formatMoney } from "../lib/format";
import type {
  ApprovalDetailResponse,
  ApprovalListResponse,
  ApprovalStatus,
  ApprovalSummary,
  PurchaseOrderResponse,
} from "../lib/types";
import { useApi, useApiMutation } from "../lib/useApi";
import { useDebounced } from "../lib/useDebounced";

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

const TABS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

function totalLabel(approval: ApprovalSummary) {
  return approval.total ? formatMoney(approval.total, approval.currency ?? "INR") : "—";
}

export default function Approvals() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const [remarks, setRemarks] = useState("");
  const [confirmPo, setConfirmPo] = useState(false);

  const debouncedSearch = useDebounced(search, 300);

  useEffect(() => {
    setPage(1);
    setSelectedId(null);
  }, [status, debouncedSearch]);

  const list = useApi<ApprovalListResponse>("/approvals", {
    status,
    search: debouncedSearch,
    page,
    pageSize: 8,
  });

  const activeId = Number(id) || selectedId || list.data?.items[0]?.id || null;
  const detail = useApi<ApprovalDetailResponse>(activeId ? `/approvals/${activeId}` : null);

  const decide = useApiMutation(
    (input: { decision: "approved" | "rejected"; remarks: string }) =>
      api.post(`/approvals/${activeId}/${input.decision === "approved" ? "approve" : "reject"}`, {
        remarks: input.remarks,
      }),
    { invalidate: ["/approvals", "/purchase-orders", "/invoices", "/dashboard", "/rfqs"] },
  );

  const createPo = useApiMutation(
    (approvalRequestId: number) => api.post<PurchaseOrderResponse>("/purchase-orders", { approvalRequestId }),
    { invalidate: ["/approvals", "/purchase-orders", "/invoices", "/dashboard"] },
  );

  function selectRequest(nextId: number) {
    setSelectedId(nextId);
    navigate(`/approvals/${nextId}`, { replace: true });
  }

  async function submitDecision() {
    if (!decision) return;
    try {
      await decide.mutateAsync({ decision, remarks });
      toast.success(
        decision === "approved" ? "Quotation approved" : "Quotation rejected",
        decision === "approved"
          ? "A purchase order can now be generated from the approved terms."
          : "The decision and remarks are recorded in the approval timeline.",
      );
      setDecision(null);
      setRemarks("");
      detail.refetch();
      list.refetch();
    } catch (error) {
      toast.error("The decision was not saved", errorMessage(error));
    }
  }

  async function generatePurchaseOrder() {
    if (!activeId) return;
    try {
      const result = await createPo.mutateAsync(activeId);
      setConfirmPo(false);
      toast.success("Purchase order ready", result.message ?? `${result.purchaseOrder.number} generated.`);
      detail.refetch();
      list.refetch();
      navigate(`/purchase-orders/${result.purchaseOrder.id}`);
    } catch (error) {
      toast.error("The purchase order was not generated", errorMessage(error));
    }
  }

  const approval = detail.data?.approval ?? null;
  const rejected = approval?.status === "rejected";
  const canDecide = Boolean(approval?.actions?.canDecide);
  const isManager = user?.role === "manager" || user?.role === "admin";

  return (
    <Page>
      <div className="page-shell">
        <PageHeader
          eyebrow="Approval workflow"
          title="Approvals"
          description="Review the vendor quotation selected by procurement. The decision, remarks and reviewer are stored with an immutable timeline."
          actions={
            <Link to="/purchase-orders" className="btn btn-ghost btn-sm">
              Purchase orders <ArrowRight size={14} />
            </Link>
          }
        />

        <div className="mb-4 grid gap-3.5 sm:grid-cols-3">
          <div className="card p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Awaiting decision</p>
            <p className="mt-1.5 text-[20px] font-extrabold text-amber-600">
              {list.data?.statusCounts?.pending ?? 0}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              {isManager ? "Requests in your approval queue." : "Waiting for a manager."}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Approved</p>
            <p className="mt-1.5 text-[20px] font-extrabold text-emerald-600">
              {list.data?.statusCounts?.approved ?? 0}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">Eligible for a purchase order.</p>
          </div>
          <div className="card p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Rejected</p>
            <p className="mt-1.5 text-[20px] font-extrabold text-rose-600">
              {list.data?.statusCounts?.rejected ?? 0}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">A decision is final and stays on record.</p>
          </div>
        </div>

        <Tabs
          tabs={TABS.map((tab) => ({
            ...tab,
            count: list.data?.statusCounts?.[tab.value],
          }))}
          value={status}
          onChange={setStatus}
          className="mb-4"
        />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <Card className="overflow-hidden">
            <div className="border-b border-line p-3">
              <SearchInput value={search} onChange={setSearch} placeholder="Search RFQ or vendor…" />
            </div>

            {list.loading ? (
              <div className="space-y-2 p-3">
                {[0, 1, 2].map((row) => (
                  <SkeletonBlock key={row} className="h-20" />
                ))}
              </div>
            ) : list.error ? (
              <div className="p-3">
                <ErrorState message={list.error.message} onRetry={list.refetch} />
              </div>
            ) : (list.data?.items.length ?? 0) === 0 ? (
              <EmptyState
                compact
                icon={<ClipboardCheck size={20} />}
                title={status === "pending" ? "No pending requests" : "Nothing here yet"}
                description={
                  status === "pending"
                    ? "Quotations submitted for approval appear in this queue."
                    : "Try another status filter or clear the search."
                }
              />
            ) : (
              <ul className="divide-y divide-line/70" aria-label="Approval requests">
                {list.data?.items.map((item) => {
                  const active = item.id === activeId;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => selectRequest(item.id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "w-full px-3.5 py-3 text-left transition-colors",
                          active ? "bg-brand-50/70" : "hover:bg-slate-50",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[12px] font-bold text-ink">{item.vendorName ?? "Vendor"}</p>
                          <Badge status={STATUS_LABEL[item.status]} />
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted">
                          {item.rfqReference ?? `RFQ #${item.rfqId}`} · rev {item.quotationRevision}
                        </p>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <span className="text-[12px] font-bold text-ink">{totalLabel(item)}</span>
                          <span className="text-[10px] font-medium text-muted">
                            {formatDateTime(item.requestedAt)}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {(list.data?.total ?? 0) > (list.data?.pageSize ?? 8) ? (
              <div className="flex items-center justify-between gap-2 border-t border-line px-3.5 py-2.5">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={(list.data?.page ?? 1) <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <span className="text-[11px] font-semibold text-muted">
                  Page {list.data?.page} of {Math.max(1, Math.ceil((list.data?.total ?? 0) / (list.data?.pageSize ?? 8)))}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={(list.data?.page ?? 1) >= Math.ceil((list.data?.total ?? 0) / (list.data?.pageSize ?? 8))}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </Button>
              </div>
            ) : null}
          </Card>

          {!activeId ? (
            <Card className="flex items-center justify-center">
              <EmptyState
                icon={<ShieldCheck size={22} />}
                title="Select an approval request"
                description="The quotation, vendor and timeline appear here for review."
              />
            </Card>
          ) : detail.loading ? (
            <Card className="p-5">
              <SkeletonBlock className="mb-4 h-6 w-48" />
              <SkeletonBlock className="mb-3 h-4 w-64" />
              <SkeletonBlock className="h-64" />
            </Card>
          ) : detail.error || !detail.data || !approval ? (
            <Card className="p-4">
              <ErrorState
                message={detail.error?.message ?? "This approval request could not be loaded."}
                onRetry={detail.refetch}
              />
            </Card>
          ) : (
            <div className="min-w-0 space-y-4">
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-slate-50/60 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                      Approval request #{approval.id}
                    </p>
                    <h2 className="mt-0.5 truncate text-[17px] font-bold text-ink">
                      {approval.vendorName ?? "Vendor quotation"}
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted">
                      Requested {formatDateTime(approval.requestedAt)}
                      {approval.requesterName ? ` by ${approval.requesterName}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <Badge status={STATUS_LABEL[approval.status]} />
                    <p className="font-mono text-[12px] font-bold text-ink">{totalLabel(approval)}</p>
                  </div>
                </div>

                <div className="grid gap-3 border-b border-line px-5 py-4 sm:grid-cols-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-muted">RFQ</p>
                    <Link
                      to={`/rfqs/${approval.rfqId}`}
                      className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:underline"
                    >
                      {approval.rfqReference}
                    </Link>
                    <p className="truncate text-[11px] text-muted">{approval.rfqTitle}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-muted">Quotation</p>
                    <p className="mt-0.5 text-[12px] font-semibold text-ink">Revision {approval.quotationRevision}</p>
                    <p className="text-[11px] text-muted">
                      {approval.deliveryDays === 0 ? "Immediate delivery" : `${approval.deliveryDays} day delivery`}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-muted">Vendor</p>
                    <p className="mt-0.5 text-[12px] font-semibold text-ink">{approval.vendorName}</p>
                    <p className="font-mono text-[11px] text-muted">{approval.vendorCode}</p>
                  </div>
                </div>

                <div className="px-5 py-4">
                  <h3 className="text-[12px] font-bold text-ink">Reviewed quotation</h3>
                  <p className="text-[11px] text-muted">
                    These are the terms frozen when the request was raised; the vendor cannot revise them while the
                    decision is open.
                  </p>

                  <div className="mt-3 overflow-x-auto">
                    <table className="table min-w-[520px]">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Description</th>
                          <th className="text-right">Qty</th>
                          <th className="text-right">Unit price</th>
                          <th className="text-right">Line total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {approval.items.map((line) => (
                          <tr key={`${line.position}-${line.rfqItemId ?? line.description}`}>
                            <td className="text-[11px] font-bold text-muted">{line.position}</td>
                            <td className="text-[12px] font-semibold text-ink">{line.description}</td>
                            <td className="whitespace-nowrap text-right text-[12px] text-ink-soft">
                              {line.quantity} <span className="text-[11px] text-muted">{line.unit}</span>
                            </td>
                            <td className="whitespace-nowrap text-right text-[12px] text-ink-soft">
                              {formatMoney(line.unitPrice, approval.currency ?? "INR")}
                            </td>
                            <td className="whitespace-nowrap text-right text-[12px] font-bold text-ink">
                              {formatMoney(line.lineTotal, approval.currency ?? "INR")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <dl className="ml-auto mt-4 max-w-xs space-y-1.5 text-[12px]">
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted">Subtotal</dt>
                      <dd className="font-semibold text-ink">
                        {formatMoney(approval.subtotal, approval.currency ?? "INR")}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted">Tax ({Number(approval.taxPercent ?? 0).toFixed(2)}%)</dt>
                      <dd className="font-semibold text-ink">
                        {formatMoney(approval.taxAmount, approval.currency ?? "INR")}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted">Delivery</dt>
                      <dd className="font-semibold text-ink">
                        {formatMoney(approval.shippingAmount, approval.currency ?? "INR")}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2">
                      <dt className="font-bold text-ink">Total</dt>
                      <dd className="text-[16px] font-extrabold text-ink">{totalLabel(approval)}</dd>
                    </div>
                  </dl>
                </div>

                {approval.requestRemarks ? (
                  <div className="border-t border-line bg-slate-50/60 px-5 py-3.5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Requester note</p>
                    <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-ink-soft">
                      {approval.requestRemarks}
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2.5 border-t border-line bg-white px-5 py-3.5">
                  {approval.status === "pending" && canDecide ? (
                    <>
                      <Button
                        size="sm"
                        icon={<CheckCircle2 size={14} />}
                        onClick={() => {
                          setRemarks("");
                          setDecision("approved");
                        }}
                      >
                        Approve quotation
                      </Button>
                      <Button
                        variant="danger-ghost"
                        size="sm"
                        icon={<XCircle size={14} />}
                        onClick={() => {
                          setRemarks("");
                          setDecision("rejected");
                        }}
                      >
                        Reject
                      </Button>
                    </>
                  ) : null}

                  {approval.status === "pending" && !canDecide ? (
                    <p className="flex items-start gap-1.5 text-[11px] text-muted">
                      <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                      {approval.actions?.isRequester
                        ? "You raised this request, so another authorised manager must decide it."
                        : user?.role === "vendor"
                          ? "Vendors cannot decide approvals."
                          : "A manager or admin is required to decide this request."}
                    </p>
                  ) : null}

                  {approval.status === "approved" ? (
                    approval.purchaseOrder ? (
                      <Link to={`/purchase-orders/${approval.purchaseOrder.id}`} className="btn btn-ghost btn-sm">
                        <FileText size={13} /> {approval.purchaseOrder.number}
                      </Link>
                    ) : approval.actions?.canGeneratePurchaseOrder ? (
                      <Button
                        size="sm"
                        icon={<BadgeCheck size={14} />}
                        onClick={() => setConfirmPo(true)}
                      >
                        Generate purchase order
                      </Button>
                    ) : (
                      <p className="text-[11px] text-muted">
                        Approved. Procurement can now generate the purchase order.
                      </p>
                    )
                  ) : null}

                  {approval.status === "rejected" ? (
                    <p className="text-[11px] text-muted">
                      This quotation was rejected and cannot be converted into a purchase order.
                    </p>
                  ) : null}
                </div>
              </Card>

              {rejected && approval.decisionRemarks ? (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-800">
                  <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
                  <div>
                    <p className="font-bold">Rejected by {approval.approverName ?? "a manager"}</p>
                    <p className="mt-0.5 whitespace-pre-line">{approval.decisionRemarks}</p>
                  </div>
                </div>
              ) : null}

              <Card className="overflow-hidden">
                <div className="border-b border-line bg-slate-50/50 px-5 py-3.5">
                  <h3 className="text-[13px] font-bold text-ink">Approval timeline</h3>
                  <p className="text-[11px] text-muted">Every event is stored with its actor, time and remarks.</p>
                </div>
                <ol className="space-y-0 px-5 py-4">
                  {(approval.timeline ?? []).map((event, index, all) => {
                    const icon =
                      event.type === "approved" ? (
                        <CheckCircle2 size={14} className="text-emerald-600" />
                      ) : event.type === "rejected" ? (
                        <XCircle size={14} className="text-rose-600" />
                      ) : (
                        <ClipboardCheck size={14} className="text-brand-600" />
                      );
                    return (
                      <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
                        {index < all.length - 1 ? (
                          <span className="absolute left-[13px] top-7 h-full w-px bg-slate-200" aria-hidden />
                        ) : null}
                        <span className="relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white">
                          {icon}
                        </span>
                        <div className="min-w-0">
                          <p className="text-[12px] font-bold text-ink">
                            {event.type === "requested"
                              ? "Approval requested"
                              : event.type === "approved"
                                ? "Approved"
                                : "Rejected"}
                            {event.actorName ? ` · ${event.actorName}` : ""}
                          </p>
                          <p className="text-[11px] text-muted">{formatDateTime(event.createdAt)}</p>
                          {event.remarks ? (
                            <p className="mt-1 whitespace-pre-line rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-soft">
                              {event.remarks}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </Card>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision === "approved" ? "Approve this quotation?" : "Reject this quotation?"}
        description={
          decision === "approved"
            ? "A purchase order can be generated from these exact terms once approved."
            : "Rejection is final and is kept on the approval timeline."
        }
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDecision(null)} disabled={decide.isPending}>
              Cancel
            </Button>
            <Button
              variant={decision === "approved" ? "primary" : "danger"}
              size="sm"
              loading={decide.isPending}
              onClick={submitDecision}
            >
              {decision === "approved" ? "Confirm approval" : "Confirm rejection"}
            </Button>
          </>
        }
      >
        <Field
          label={decision === "approved" ? "Remarks (optional)" : "Reason for rejection"}
          htmlFor="decision-remarks"
          required={decision === "rejected"}
          hint={decision === "rejected" ? "At least 5 characters — the vendor's quotation stays on record." : undefined}
        >
          <Textarea
            id="decision-remarks"
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            maxLength={1000}
            placeholder={
              decision === "approved"
                ? "e.g. Competitive pricing, delivery within the required window."
                : "e.g. Delivery timeline exceeds the required window."
            }
          />
        </Field>
      </Modal>

      <Modal
        open={confirmPo}
        onClose={() => setConfirmPo(false)}
        title="Generate purchase order?"
        description="The purchase order copies the approved quotation snapshot exactly. It cannot be edited afterwards."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmPo(false)} disabled={createPo.isPending}>
              Cancel
            </Button>
            <Button size="sm" loading={createPo.isPending} onClick={generatePurchaseOrder}>
              Generate purchase order
            </Button>
          </>
        }
      >
        {approval ? (
          <dl className="space-y-2 text-[12px]">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Vendor</dt>
              <dd className="font-semibold text-ink">{approval.vendorName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Quotation total</dt>
              <dd className="font-semibold text-ink">{totalLabel(approval)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Source RFQ</dt>
              <dd className="font-semibold text-ink">{approval.rfqReference}</dd>
            </div>
          </dl>
        ) : null}
      </Modal>
    </Page>
  );
}
