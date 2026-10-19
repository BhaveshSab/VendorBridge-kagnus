import { ArrowLeft, ArrowRight, ClipboardList, Eye, Inbox } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Page } from "../components/guards";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Select,
  SkeletonBlock,
} from "../components/ui";
import { formatDateTime, formatMoney } from "../lib/format";
import type { RfqQuotationsResponse, RfqItem } from "../lib/types";
import { useApi } from "../lib/useApi";

export default function RfqQuotations() {
  const { id } = useParams();
  const rfqId = Number(id);
  const [sort, setSort] = useState("total_asc");
  const [openQuotationId, setOpenQuotationId] = useState<number | null>(null);

  const data = useApi<RfqQuotationsResponse>(
    Number.isInteger(rfqId) ? `/rfqs/${rfqId}/quotations` : null,
    { sort },
  );

  if (data.loading) {
    return (
      <div className="page-shell">
        <SkeletonBlock className="mb-4 h-5 w-40" />
        <SkeletonBlock className="mb-6 h-9 w-80" />
        <SkeletonBlock className="h-72" />
      </div>
    );
  }

  if (data.error || !data.data) {
    return (
      <div className="page-shell">
        <Link to="/rfqs" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-brand-600">
          <ArrowLeft size={14} /> Back to RFQs
        </Link>
        <PageHeader eyebrow="Quotations" title="Quotations" />
        <ErrorState message={data.error?.message ?? "Quotations could not be loaded."} onRetry={data.refetch} />
      </div>
    );
  }

  const { rfq, items, quotations } = data.data;
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const openQuotation = quotations.find((quotation) => quotation.id === openQuotationId) ?? null;
  const awaiting = Math.max(0, rfq.vendorCount - quotations.length);

  return (
    <Page>
      <div className="page-shell">
        <Link to={`/rfqs/${rfq.id}`} className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-brand-600">
          <ArrowLeft size={14} /> Back to RFQ
        </Link>

        <PageHeader
          eyebrow={
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700">{rfq.reference}</span>
              <Badge status={rfq.effectiveStatus.charAt(0).toUpperCase() + rfq.effectiveStatus.slice(1)} />
            </span>
          }
          title="Submitted quotations"
          description={`${rfq.title} · ${quotations.length} of ${rfq.vendorCount} invited vendor${rfq.vendorCount === 1 ? "" : "s"} responded · ${rfq.currency}`}
          actions={
            <Link to={`/rfqs/${rfq.id}/compare`} className="btn btn-primary btn-sm">
              Compare quotations <ArrowRight size={14} />
            </Link>
          }
        />

        <div className="mb-4 grid gap-3.5 sm:grid-cols-3">
          <div className="card p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Quotations received</p>
            <p className="mt-1.5 text-[20px] font-extrabold text-ink">{quotations.length}</p>
            <p className="mt-0.5 text-[11px] text-muted">One quotation per vendor.</p>
          </div>
          <div className="card p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Still awaiting</p>
            <p className="mt-1.5 text-[20px] font-extrabold text-ink">{awaiting}</p>
            <p className="mt-0.5 text-[11px] text-muted">Assigned vendors without a submission.</p>
          </div>
          <div className="card p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Requested lines</p>
            <p className="mt-1.5 text-[20px] font-extrabold text-ink">{items.length}</p>
            <p className="mt-0.5 text-[11px] text-muted">Every line is priced in each quotation.</p>
          </div>
        </div>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-line bg-slate-50/40 p-4">
            <div>
              <h2 className="text-[13px] font-bold text-ink">Quotation register</h2>
              <p className="text-[11px] text-muted">Totals include tax and delivery, calculated by the server.</p>
            </div>
            <Select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              aria-label="Sort quotations"
              className="input-sm ml-auto w-auto font-medium"
            >
              <option value="total_asc">Lowest total first</option>
              <option value="total_desc">Highest total first</option>
              <option value="submitted">Newest submission</option>
              <option value="vendor">Vendor A–Z</option>
            </Select>
          </div>

          {quotations.length === 0 ? (
            <EmptyState
              icon={<Inbox size={22} />}
              title="No quotations submitted yet"
              description={
                rfq.vendorCount === 0
                  ? "No vendors were assigned to this RFQ."
                  : `${rfq.vendorCount} vendor${rfq.vendorCount === 1 ? " was" : "s were"} invited. Submissions appear here as soon as they are saved.`
              }
              action={
                <Link to={`/rfqs/${rfq.id}`} className="btn btn-ghost btn-sm">
                  View RFQ
                </Link>
              }
            />
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th className="hidden sm:table-cell">Submitted</th>
                    <th className="hidden md:table-cell">Delivery</th>
                    <th className="hidden lg:table-cell">Revision</th>
                    <th className="text-right">Quoted total</th>
                    <th className="text-right">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {quotations.map((quotation) => (
                    <tr key={quotation.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-200/60 bg-gradient-to-tr from-brand-50 to-indigo-50 text-[11px] font-bold text-brand-700">
                            {(quotation.vendorName ?? "V").slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-bold text-ink">{quotation.vendorName}</p>
                            <p className="font-mono text-[10px] text-muted">{quotation.vendorCode}</p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden text-[11px] text-muted sm:table-cell">{formatDateTime(quotation.submittedAt)}</td>
                      <td className="hidden text-[12px] font-semibold text-ink-soft md:table-cell">
                        {quotation.deliveryDays === 0 ? "Immediate" : `${quotation.deliveryDays} day(s)`}
                      </td>
                      <td className="hidden lg:table-cell">
                        <span className="badge badge-submitted">rev {quotation.revision}</span>
                      </td>
                      <td className="text-right text-[12px] font-bold text-ink">
                        {formatMoney(quotation.total, quotation.currency)}
                      </td>
                      <td className="text-right">
                        <Button variant="ghost" size="sm" icon={<Eye size={13} />} onClick={() => setOpenQuotationId(quotation.id)}>
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <p className="mt-4 text-[11px] text-muted">
          Quotations belong to {rfq.reference} only. Vendor prices and notes are visible to procurement staff and never to
          other vendors.
        </p>
      </div>

      <Modal
        open={Boolean(openQuotation)}
        onClose={() => setOpenQuotationId(null)}
        size="xl"
        title={openQuotation ? `${openQuotation.vendorName} — ${rfq.reference}` : "Quotation"}
        description={
          openQuotation
            ? `Submitted ${formatDateTime(openQuotation.submittedAt)} · revision ${openQuotation.revision} · ${openQuotation.currency}`
            : undefined
        }
        footer={
          <Button variant="ghost" size="sm" onClick={() => setOpenQuotationId(null)}>
            Close
          </Button>
        }
      >
        {openQuotation ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
              <Badge status="Submitted" />
              <span className="text-[12px] font-semibold text-ink-soft">
                {formatMoney(openQuotation.total, openQuotation.currency)}
              </span>
              <span className="text-[11px] text-muted">
                {openQuotation.deliveryDays === 0 ? "Immediate delivery" : `${openQuotation.deliveryDays} day delivery`}
                {openQuotation.deliveryTerms ? ` · ${openQuotation.deliveryTerms}` : ""}
              </span>
            </div>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Requested item</th>
                    <th className="text-right">Quantity</th>
                    <th className="text-right">Unit price</th>
                    <th className="text-right">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {openQuotation.items.map((line) => {
                    const item: RfqItem | undefined = itemsById.get(line.rfqItemId);
                    return (
                      <tr key={line.id}>
                        <td className="text-[12px] font-semibold text-ink">{item?.description ?? `Item #${line.rfqItemId}`}</td>
                        <td className="text-right text-[12px] text-muted">
                          {item ? `${item.quantity} ${item.unit}` : "—"}
                        </td>
                        <td className="text-right text-[12px] text-ink-soft">
                          {formatMoney(line.unitPrice, openQuotation.currency)}
                        </td>
                        <td className="text-right text-[12px] font-bold text-ink">
                          {formatMoney(line.lineTotal, openQuotation.currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <dl className="ml-auto max-w-sm space-y-1.5 text-[12px]">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Subtotal</dt>
                <dd className="font-semibold text-ink">{formatMoney(openQuotation.subtotal, openQuotation.currency)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Tax ({openQuotation.taxPercent}%)</dt>
                <dd className="font-semibold text-ink">{formatMoney(openQuotation.taxAmount, openQuotation.currency)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Delivery / shipping</dt>
                <dd className="font-semibold text-ink">
                  {formatMoney(openQuotation.shippingAmount, openQuotation.currency)}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-line pt-1.5">
                <dt className="font-bold text-ink">Total</dt>
                <dd className="text-[14px] font-bold text-ink">{formatMoney(openQuotation.total, openQuotation.currency)}</dd>
              </div>
            </dl>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                <ClipboardList size={12} /> Vendor notes
              </p>
              <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-ink-soft">
                {openQuotation.notes || "No notes were provided."}
              </p>
            </div>
          </div>
        ) : null}
      </Modal>
    </Page>
  );
}
