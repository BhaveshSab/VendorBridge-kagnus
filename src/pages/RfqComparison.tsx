import { AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, Inbox, Info, Scale } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Page } from "../components/guards";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
  SkeletonBlock,
} from "../components/ui";
import { formatDateTime, formatMoney } from "../lib/format";
import type { ComparisonQuotation, RfqComparisonResponse } from "../lib/types";
import { useApi } from "../lib/useApi";

function SortControl({ sort, onChange }: { sort: string; onChange: (value: string) => void }) {
  return (
    <Select
      value={sort}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Sort comparison columns"
      className="input-sm w-auto font-medium"
    >
      <option value="lowest">Lowest total first</option>
      <option value="vendor">Vendor A–Z</option>
      <option value="submitted">Newest submission</option>
    </Select>
  );
}

function sortQuotations(quotations: ComparisonQuotation[], sort: string) {
  const rows = [...quotations];
  if (sort === "vendor") rows.sort((a, b) => String(a.vendorName).localeCompare(String(b.vendorName)));
  else if (sort === "submitted") rows.sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
  else
    rows.sort(
      (a, b) => Number(a.total) - Number(b.total) || Date.parse(a.submittedAt) - Date.parse(b.submittedAt),
    );
  return rows;
}

export default function RfqComparison() {
  const { id } = useParams();
  const rfqId = Number(id);
  const [sort, setSort] = useState("lowest");

  const data = useApi<RfqComparisonResponse>(
    Number.isInteger(rfqId) ? `/rfqs/${rfqId}/comparison` : null,
  );

  const columns = useMemo(() => (data.data ? sortQuotations(data.data.quotations, sort) : []), [data.data, sort]);

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
        <PageHeader eyebrow="Quotation comparison" title="Compare quotations" />
        <ErrorState message={data.error?.message ?? "The comparison could not be loaded."} onRetry={data.refetch} />
      </div>
    );
  }

  const { rfq, items, basis, summary, lowest, quotations, excluded } = data.data;

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
          title="Quotation comparison"
          description={`${rfq.title} · ${quotations.length} saved quotation${quotations.length === 1 ? "" : "s"} · deadline ${formatDateTime(rfq.deadline)}`}
          actions={
            <>
              <Link to={`/rfqs/${rfq.id}/quotations`} className="btn btn-ghost btn-sm">
                Quotation register
              </Link>
              {quotations.length > 1 ? <SortControl sort={sort} onChange={setSort} /> : null}
            </>
          }
        />

        <div className="mb-4 flex flex-wrap items-start gap-2 rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3 text-[11px] leading-relaxed text-slate-600">
          <Scale size={14} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />
          <div>
            <p className="font-bold text-brand-800">Comparison basis</p>
            <p className="mt-0.5">{basis.totalDefinition}</p>
            <p className="mt-1">
              Currency <span className="font-semibold text-ink">{basis.currency}</span> · tax{" "}
              {basis.includesTax ? "included" : "excluded"} · delivery{" "}
              {basis.includesShipping ? "included" : "excluded"} · compared on{" "}
              <span className="font-mono text-[10px] font-semibold">{basis.comparisonField}</span>. Only quotations with the
              same cost basis and every requested item priced are eligible for the lowest-price highlight.
            </p>
          </div>
        </div>

        <div className="mb-4 grid gap-3.5 sm:grid-cols-3">
          <div className="card p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Saved quotations</p>
            <p className="mt-1.5 text-[20px] font-extrabold text-ink">{summary.quotationCount}</p>
            <p className="mt-0.5 text-[11px] text-muted">For this RFQ only.</p>
          </div>
          <div className="card p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Comparable</p>
            <p className="mt-1.5 text-[20px] font-extrabold text-emerald-600">{summary.comparableCount}</p>
            <p className="mt-0.5 text-[11px] text-muted">
              {summary.excludedCount} excluded from the highlight.
            </p>
          </div>
          <div className="card p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Lowest total</p>
            <p className="mt-1.5 text-[20px] font-extrabold text-ink">
              {summary.lowestTotal ? formatMoney(summary.lowestTotal, basis.currency) : "—"}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              {summary.canCompare ? "Server-calculated total." : "No valid comparison available."}
            </p>
          </div>
        </div>

        {lowest ? (
          <Card className="mb-4 overflow-hidden border-emerald-200 bg-gradient-to-r from-emerald-50/70 to-white">
            <div className="flex flex-wrap items-center gap-4 px-5 py-4">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700">
                <BadgeCheck size={22} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-700">Lowest comparable total</p>
                <p className="mt-0.5 text-[15px] font-bold text-ink">{lowest.vendorName}</p>
                <p className="text-[11px] text-muted">
                  {lowest.vendorCode} · {lowest.deliveryDays === 0 ? "Immediate delivery" : `${lowest.deliveryDays} day delivery`} ·
                  submitted {formatDateTime(lowest.submittedAt)}
                </p>
              </div>
              <p className="text-[22px] font-extrabold tracking-tight text-emerald-700">
                {formatMoney(lowest.total, basis.currency)}
              </p>
            </div>
            <p className="border-t border-emerald-100 bg-white/70 px-5 py-2 text-[11px] text-muted">
              This is a comparison result only — no award, approval or purchase order is created.
            </p>
          </Card>
        ) : quotations.length > 0 ? (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-[12px] text-orange-800">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
            <div>
              <p className="font-bold">No comparable quotation</p>
              <p className="mt-0.5">
                Every saved quotation was excluded from the highlight. Reasons are listed below each quotation.
              </p>
            </div>
          </div>
        ) : null}

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-slate-50/50 px-5 py-3.5">
            <div>
              <h2 className="text-[13px] font-bold text-ink">Side-by-side comparison</h2>
              <p className="text-[11px] text-muted">
                Prices shown as unit price, with the line total below. Totals are recalculated by the server.
              </p>
            </div>
            {quotations.length > 1 ? <SortControl sort={sort} onChange={setSort} /> : null}
          </div>

          {quotations.length === 0 ? (
            <EmptyState
              icon={<Inbox size={22} />}
              title="No quotations to compare"
              description={
                rfq.vendorCount === 0
                  ? "No vendors were assigned to this RFQ."
                  : "Assigned vendors have not submitted a quotation yet. The comparison appears once submissions exist."
              }
              action={
                <Link to={`/rfqs/${rfq.id}`} className="btn btn-ghost btn-sm">
                  View RFQ
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table min-w-[720px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 min-w-[220px] bg-slate-50">Requested item</th>
                    {columns.map((quotation) => (
                      <th
                        key={quotation.id}
                        className={`min-w-[180px] align-top ${quotation.isLowest ? "bg-emerald-50/70" : ""}`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12px] font-bold text-ink">{quotation.vendorName}</span>
                            {quotation.isLowest ? <span className="badge badge-lowest">Lowest</span> : null}
                          </div>
                          <p className="font-mono text-[10px] font-medium text-muted">{quotation.vendorCode}</p>
                          <p className="text-[13px] font-extrabold text-ink">
                            {formatMoney(quotation.total, quotation.currency)}
                          </p>
                          <p className="text-[10px] font-medium text-muted">
                            {quotation.deliveryDays === 0 ? "Immediate" : `${quotation.deliveryDays} day(s)`} · rev{" "}
                            {quotation.revision}
                          </p>
                          {quotation.compatible ? (
                            <span className="badge badge-submitted">Comparable</span>
                          ) : (
                            <span className="badge badge-overdue">Excluded</span>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="sticky left-0 z-10 bg-white">
                        <p className="text-[12px] font-semibold text-ink">{item.description}</p>
                        <p className="text-[10px] text-muted">
                          {item.quantity} {item.unit}
                          {item.specifications ? ` · ${item.specifications}` : ""}
                        </p>
                      </td>
                      {columns.map((quotation) => {
                        const line = quotation.calculatedLines.find((entry) => entry.rfqItemId === item.id);
                        return (
                          <td
                            key={`${quotation.id}-${item.id}`}
                            className={quotation.isLowest ? "bg-emerald-50/40" : undefined}
                          >
                            {line ? (
                              <>
                                <p className="text-[12px] font-semibold text-ink">
                                  {formatMoney(line.unitPrice, quotation.currency)}
                                </p>
                                <p className="text-[10px] text-muted">
                                  Line {formatMoney(line.lineTotal, quotation.currency)}
                                </p>
                              </>
                            ) : (
                              <span className="text-[11px] font-medium text-danger">Not priced</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {[
                    { label: "Subtotal", key: "subtotal" as const },
                    { label: "Tax", key: "taxAmount" as const },
                    { label: "Shipping", key: "shippingAmount" as const },
                    { label: "Delivery timeline", key: "deliveryDays" as const },
                    { label: "Total", key: "total" as const },
                  ].map((row) => (
                    <tr key={row.key} className={row.key === "total" ? "bg-slate-50/70" : undefined}>
                      <td className="sticky left-0 z-10 bg-white font-bold text-ink">
                        <span className={row.key === "total" ? "text-[12px] font-extrabold" : "text-[12px]"}>{row.label}</span>
                      </td>
                      {columns.map((quotation) => (
                        <td
                          key={`${quotation.id}-${row.key}`}
                          className={quotation.isLowest ? "bg-emerald-50/40" : undefined}
                        >
                          <span
                            className={
                              row.key === "total"
                                ? "text-[13px] font-extrabold text-ink"
                                : "text-[12px] font-semibold text-ink-soft"
                            }
                          >
                            {row.key === "deliveryDays"
                              ? quotation.deliveryDays === 0
                                ? "Immediate"
                                : `${quotation.deliveryDays} day(s)`
                              : formatMoney(quotation[row.key], quotation.currency)}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td className="sticky left-0 z-10 bg-white align-top font-bold text-ink">
                      <span className="text-[12px]">Notes</span>
                    </td>
                    {columns.map((quotation) => (
                      <td
                        key={`${quotation.id}-notes`}
                        className={`align-top ${quotation.isLowest ? "bg-emerald-50/40" : ""}`}
                      >
                        <p className="max-w-[220px] whitespace-pre-line text-[11px] leading-relaxed text-muted">
                          {quotation.notes || "—"}
                        </p>
                        {quotation.deliveryTerms ? (
                          <p className="mt-1 text-[10px] font-medium text-slate-500">{quotation.deliveryTerms}</p>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {excluded.length > 0 ? (
          <Card className="mt-4 overflow-hidden">
            <div className="border-b border-line bg-slate-50/50 px-5 py-3.5">
              <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
                <Info size={14} className="text-brand-600" /> Excluded from the lowest-price highlight
              </h2>
              <p className="text-[11px] text-muted">These quotations are still saved and visible — they just cannot be ranked.</p>
            </div>
            <ul className="divide-y divide-line/70">
              {excluded.map((entry) => (
                <li key={entry.quotationId} className="px-5 py-3.5">
                  <p className="text-[12px] font-bold text-ink">{entry.vendorName ?? `Quotation #${entry.quotationId}`}</p>
                  <ul className="mt-1 space-y-0.5">
                    {entry.reasons.map((reason) => (
                      <li key={reason} className="text-[11px] text-muted">
                        • {reason}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted">
          <ArrowRight size={12} /> Comparison never awards a contract; approval and purchase-order workflows are outside Week 2.
        </p>
      </div>
    </Page>
  );
}
