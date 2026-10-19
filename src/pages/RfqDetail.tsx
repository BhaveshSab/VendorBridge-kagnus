import {
  ArrowLeft,
  ArrowRight,
  Ban,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Coins,
  FileText,
  Lock,
  Pencil,
  Send,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Page } from "../components/guards";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  PageHeader,
  SkeletonBlock,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { deadlineMeta, formatDate, formatDateTime, formatMoney } from "../lib/format";
import type { RfqDetail, RfqDetailResponse } from "../lib/types";
import { useApi, useApiMutation } from "../lib/useApi";

type ActionKind = "publish" | "close" | "cancel";

function statusLabel(rfq: RfqDetail) {
  return rfq.effectiveStatus.charAt(0).toUpperCase() + rfq.effectiveStatus.slice(1);
}

export default function RfqDetail() {
  const { id } = useParams();
  const rfqId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const { user, permissions } = useAuth();
  const isVendor = user?.role === "vendor";
  const canManage = Boolean(permissions?.manageRfqs);
  const canViewQuotations = Boolean(permissions?.viewQuotations);

  const [confirm, setConfirm] = useState<ActionKind | null>(null);

  const detail = useApi<RfqDetailResponse>(Number.isInteger(rfqId) ? `/rfqs/${rfqId}` : null);
  const action = useApiMutation(
    (kind: ActionKind) => api.post(`/rfqs/${rfqId}/${kind}`),
    { invalidate: ["/rfqs", "/dashboard"] },
  );

  if (detail.loading) {
    return (
      <div className="page-shell">
        <SkeletonBlock className="mb-4 h-5 w-40" />
        <SkeletonBlock className="mb-6 h-9 w-96" />
        <div className="grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <SkeletonBlock key={item} className="h-24" />
          ))}
        </div>
        <SkeletonBlock className="mt-5 h-64" />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div className="page-shell">
        <Link to="/rfqs" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-brand-600">
          <ArrowLeft size={14} /> Back to RFQs
        </Link>
        <PageHeader eyebrow="Requests for quotation" title="RFQ" />
        <ErrorState
          message={detail.error?.message ?? "This RFQ could not be loaded."}
          onRetry={detail.refetch}
        />
      </div>
    );
  }

  const { rfq, myQuotation, submission } = detail.data;
  const deadline = deadlineMeta(rfq.deadline);
  const isDraft = rfq.status === "draft";
  const isOpen = rfq.status === "open" && !deadline.expired;
  const canSubmitNow = Boolean(submission?.canSubmit);

  async function runAction(kind: ActionKind) {
    setConfirm(null);
    try {
      await action.mutateAsync(kind);
      toast.success(
        kind === "publish" ? "RFQ published" : kind === "close" ? "RFQ closed" : "RFQ cancelled",
        kind === "publish"
          ? `${rfq.reference} is now visible to the assigned vendors.`
          : kind === "close"
            ? `${rfq.reference} no longer accepts quotations.`
            : `${rfq.reference} was cancelled and cannot be quoted.`,
      );
      detail.refetch();
    } catch (error) {
      toast.error("Action failed", errorMessage(error));
    }
  }

  const confirmCopy: Record<ActionKind, { title: string; message: string; label: string }> = {
    publish: {
      title: `Publish ${rfq.reference}?`,
      message: `Publishing grants the ${rfq.vendorCount} assigned vendor${rfq.vendorCount === 1 ? "" : "s"} access to this RFQ and lets them submit quotations until ${formatDateTime(rfq.deadline)}. Line items and vendor assignments are locked after publication.`,
      label: "Publish RFQ",
    },
    close: {
      title: `Close ${rfq.reference}?`,
      message:
        "Closing stops all further submissions immediately. Existing quotations stay available for review and comparison. This cannot be undone.",
      label: "Close RFQ",
    },
    cancel: {
      title: `Cancel ${rfq.reference}?`,
      message:
        "Cancelling withdraws the RFQ. Assigned vendors can no longer open or quote it. This cannot be undone.",
      label: "Cancel RFQ",
    },
  };

  return (
    <Page>
      <div className="page-shell">
        <Link to="/rfqs" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-brand-600">
          <ArrowLeft size={14} /> Back to RFQs
        </Link>

        <PageHeader
          eyebrow={
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                {rfq.reference}
              </span>
              <Badge status={statusLabel(rfq)} />
            </span>
          }
          title={rfq.title}
          description={`Created ${formatDate(rfq.createdAt)}${rfq.creatorName ? ` by ${rfq.creatorName}` : ""}${
            rfq.publishedAt ? ` · Published ${formatDateTime(rfq.publishedAt)}` : " · Not yet published"
          }`}
          actions={
            <>
              {canViewQuotations ? (
                <>
                  <Link to={`/rfqs/${rfq.id}/quotations`} className="btn btn-ghost btn-sm">
                    <ClipboardList size={14} /> Quotations
                  </Link>
                  <Link to={`/rfqs/${rfq.id}/compare`} className="btn btn-primary btn-sm">
                    Compare quotations <ArrowRight size={14} />
                  </Link>
                </>
              ) : null}
              {isDraft && canManage ? (
                <>
                  <Button variant="ghost" size="sm" icon={<Pencil size={13} />} onClick={() => navigate(`/rfqs/${rfq.id}/edit`)}>
                    Edit draft
                  </Button>
                  <Button size="sm" icon={<Send size={13} />} onClick={() => setConfirm("publish")}>
                    Publish
                  </Button>
                </>
              ) : null}
              {isOpen && canManage ? (
                <Button variant="ghost" size="sm" icon={<Lock size={13} />} onClick={() => setConfirm("close")}>
                  Close RFQ
                </Button>
              ) : null}
              {(isDraft || isOpen) && canManage ? (
                <Button variant="danger-ghost" size="sm" icon={<Ban size={13} />} onClick={() => setConfirm("cancel")}>
                  Cancel
                </Button>
              ) : null}
            </>
          }
        />

        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <div className="card p-4">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
              <CalendarClock size={13} /> Submission deadline
            </p>
            <p className="mt-1.5 text-[15px] font-bold text-ink">{formatDateTime(rfq.deadline)}</p>
            <p className={`mt-0.5 text-[11px] font-semibold ${deadline.expired ? "text-orange-600" : "text-emerald-600"}`}>
              {deadline.label}
            </p>
          </div>
          <div className="card p-4">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
              <Coins size={13} /> Quotation currency
            </p>
            <p className="mt-1.5 text-[15px] font-bold text-ink">{rfq.currency}</p>
            <p className="mt-0.5 text-[11px] text-muted">All quotations are compared in this currency.</p>
          </div>
          <div className="card p-4">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
              <ClipboardList size={13} /> Requested items
            </p>
            <p className="mt-1.5 text-[15px] font-bold text-ink">{rfq.items.length}</p>
            <p className="mt-0.5 text-[11px] text-muted">Each must be priced by the vendor.</p>
          </div>
          <div className="card p-4">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
              <Users size={13} /> {isVendor ? "Vendors invited" : "Quotations received"}
            </p>
            <p className="mt-1.5 text-[15px] font-bold text-ink">
              {isVendor ? rfq.vendorCount : rfq.quotationCount}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              {isVendor ? "Including your company." : `of ${rfq.vendorCount} assigned vendor${rfq.vendorCount === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        {isVendor && submission && !submission.canSubmit ? (
          <div className="mt-4 rounded-xl border border-orange-200 border-l-4 border-l-orange-400 bg-orange-50 px-4 py-3 text-[12px] text-orange-800">
            <p className="font-bold">Quotation window closed</p>
            <p className="mt-0.5">{submission.reason ?? "This RFQ is not accepting quotations."}</p>
          </div>
        ) : null}

        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <div className="min-w-0 space-y-5 lg:col-span-2">
            <Card className="overflow-hidden">
              <div className="border-b border-line bg-slate-50/50 px-5 py-3.5">
                <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
                  <FileText size={15} className="text-brand-600" /> Requirements
                </h2>
              </div>
              <div className="px-5 py-4">
                <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-soft">
                  {rfq.description || "No additional description was provided."}
                </p>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-line bg-slate-50/50 px-5 py-3.5">
                <h2 className="text-[13px] font-bold text-ink">Requested line items</h2>
                <p className="text-[11px] text-muted">Vendors quote a unit price for each line.</p>
              </div>
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Description</th>
                      <th className="hidden md:table-cell">Specifications</th>
                      <th className="text-right">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfq.items.map((item, index) => (
                      <tr key={item.id}>
                        <td className="text-[11px] font-bold text-muted">{index + 1}</td>
                        <td className="text-[12px] font-semibold text-ink">{item.description}</td>
                        <td className="hidden text-[12px] text-muted md:table-cell">{item.specifications || "—"}</td>
                        <td className="text-right text-[12px] font-bold text-ink">
                          {item.quantity} <span className="font-medium text-muted">{item.unit}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {!isVendor ? (
              <Card className="overflow-hidden">
                <div className="border-b border-line bg-slate-50/50 px-5 py-3.5">
                  <h2 className="text-[13px] font-bold text-ink">Assigned vendors &amp; submissions</h2>
                  <p className="text-[11px] text-muted">Only these vendors can see this RFQ.</p>
                </div>
                {rfq.assignments && rfq.assignments.length > 0 ? (
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Vendor</th>
                          <th>Submission</th>
                          <th className="hidden sm:table-cell">Submitted</th>
                          <th className="text-right">Quoted total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(rfq.submissions ?? []).map((entry) => (
                          <tr key={entry.vendorId}>
                            <td>
                              <p className="text-[12px] font-bold text-ink">{entry.vendorName ?? `Vendor #${entry.vendorId}`}</p>
                              <p className="font-mono text-[10px] text-muted">{entry.vendorCode}</p>
                            </td>
                            <td>
                              <Badge status={entry.status === "submitted" ? "Submitted" : "Awaiting"} />
                            </td>
                            <td className="hidden text-[11px] text-muted sm:table-cell">
                              {entry.submittedAt ? formatDateTime(entry.submittedAt) : "—"}
                            </td>
                            <td className="text-right text-[12px] font-bold text-ink">
                              {entry.total ? formatMoney(entry.total, rfq.currency) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="px-5 py-6 text-[12px] text-muted">No vendors assigned yet.</p>
                )}
              </Card>
            ) : null}
          </div>

          <div className="min-w-0 space-y-5">
            {isVendor ? (
              <Card className="overflow-hidden">
                <div className="border-b border-line bg-slate-50/50 px-5 py-3.5">
                  <h2 className="text-[13px] font-bold text-ink">Your quotation</h2>
                  <p className="text-[11px] text-muted">Only your company can see these prices.</p>
                </div>
                {myQuotation ? (
                  <div className="space-y-4 px-5 py-4">
                    <div className="flex items-center justify-between gap-2">
                      <Badge status="Submitted" />
                      <span className="text-[11px] font-semibold text-muted">Revision {myQuotation.revision}</span>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Quoted total</p>
                      <p className="text-[22px] font-extrabold tracking-tight text-ink">
                        {formatMoney(myQuotation.total, myQuotation.currency)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        Includes {myQuotation.taxPercent}% tax and {formatMoney(myQuotation.shippingAmount, myQuotation.currency)} delivery.
                      </p>
                    </div>
                    <dl className="space-y-1.5 text-[12px]">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Delivery timeline</dt>
                        <dd className="font-semibold text-ink">
                          {myQuotation.deliveryDays === 0 ? "Immediate" : `${myQuotation.deliveryDays} day(s)`}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Submitted</dt>
                        <dd className="font-semibold text-ink">{formatDateTime(myQuotation.submittedAt)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Last updated</dt>
                        <dd className="font-semibold text-ink">{formatDateTime(myQuotation.updatedAt)}</dd>
                      </div>
                    </dl>
                    <ul className="space-y-1.5 border-t border-line pt-3" aria-label="Your line prices">
                      {myQuotation.items.map((line) => {
                        const item = rfq.items.find((entry) => entry.id === line.rfqItemId);
                        return (
                          <li key={line.id} className="flex items-baseline justify-between gap-3 text-[11px]">
                            <span className="min-w-0 truncate text-muted">
                              {item ? `${item.quantity} ${item.unit} × ${item.description}` : `Item #${line.rfqItemId}`}
                            </span>
                            <span className="shrink-0 font-semibold text-ink">
                              {formatMoney(line.lineTotal, myQuotation.currency)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {myQuotation.notes ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Your notes</p>
                        <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">{myQuotation.notes}</p>
                      </div>
                    ) : null}
                    {canSubmitNow ? (
                      <Link to={`/rfqs/${rfq.id}/quotation`} className="btn btn-ghost btn-sm w-full justify-center">
                        <Pencil size={13} /> Revise quotation
                      </Link>
                    ) : (
                      <p className="flex items-start gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-600">
                        <Lock size={12} className="mt-0.5 shrink-0" />
                        Revisions are locked while the RFQ is closed or past its deadline.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="px-5 py-6 text-center">
                    <p className="text-[13px] font-bold text-ink">
                      {canSubmitNow ? "You have not quoted yet" : "No quotation submitted"}
                    </p>
                    <p className="mx-auto mt-1 max-w-xs text-[12px] leading-relaxed text-muted">
                      {canSubmitNow
                        ? "Price every requested item, add your delivery timeline, then submit."
                        : submission?.reason ?? "This RFQ is not accepting quotations."}
                    </p>
                    {canSubmitNow ? (
                      <Link to={`/rfqs/${rfq.id}/quotation`} className="btn btn-primary btn-sm mt-4 inline-flex">
                        <Send size={13} /> Submit quotation
                      </Link>
                    ) : null}
                  </div>
                )}
              </Card>
            ) : null}

            <Card className="p-5">
              <p className="text-[13px] font-bold text-ink">How this RFQ was run</p>
              <ul className="mt-3 space-y-2.5 text-[12px] text-muted">
                <li className="flex gap-2">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                  {rfq.publishedAt ? `Published ${formatDateTime(rfq.publishedAt)}` : "Draft — not visible to vendors"}
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                  {rfq.vendorCount} vendor{rfq.vendorCount === 1 ? "" : "s"} assigned while in draft
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                  Deadline enforced in UTC by the API
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                  One quotation per vendor; revisions allowed until the deadline
                </li>
              </ul>
            </Card>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirm != null}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && runAction(confirm)}
        loading={action.isPending}
        tone={confirm === "publish" ? "primary" : "danger"}
        title={confirm ? confirmCopy[confirm].title : ""}
        message={confirm ? confirmCopy[confirm].message : ""}
        confirmLabel={confirm ? confirmCopy[confirm].label : "Confirm"}
      />
    </Page>
  );
}
