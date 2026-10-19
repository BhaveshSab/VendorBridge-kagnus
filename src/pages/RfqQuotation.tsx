import { AlertCircle, ArrowLeft, CalendarClock, Coins, Info, Lock, Send, Truck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Page } from "../components/guards";
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, SkeletonBlock, Textarea } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { api, ApiError, errorMessage } from "../lib/api";
import { deadlineMeta, formatDateTime, formatMoney } from "../lib/format";
import type { Quotation, RfqDetail, RfqDetailResponse } from "../lib/types";
import { useApi, useApiMutation } from "../lib/useApi";

interface QuotationPayload {
  deliveryDays: number;
  deliveryTerms: string;
  notes: string;
  taxPercent: string;
  shippingAmount: string;
  items: { rfqItemId: number; unitPrice: string }[];
}

interface FormState {
  prices: Record<number, string>;
  deliveryDays: string;
  deliveryTerms: string;
  notes: string;
  taxPercent: string;
  shippingAmount: string;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function initialForm(rfq: RfqDetail, quotation: Quotation | null): FormState {
  const prices: Record<number, string> = {};
  for (const item of rfq.items) {
    const line = quotation?.items.find((entry) => entry.rfqItemId === item.id);
    prices[item.id] = line ? line.unitPrice : "";
  }
  return {
    prices,
    deliveryDays: quotation ? String(quotation.deliveryDays) : "7",
    deliveryTerms: quotation?.deliveryTerms ?? "",
    notes: quotation?.notes ?? "",
    taxPercent: quotation ? quotation.taxPercent : "0",
    shippingAmount: quotation ? quotation.shippingAmount : "0",
  };
}

function QuotationForm({
  rfq,
  quotation,
}: {
  rfq: RfqDetail;
  quotation: Quotation | null;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => initialForm(rfq, quotation));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submit = useApiMutation<{ message: string; revision: number; quotation: Quotation }, QuotationPayload>(
    (payload) => api.put(`/rfqs/${rfq.id}/quotation`, payload),
    { invalidate: ["/rfqs", "/dashboard"] },
  );

  const linePreviews = rfq.items.map((item) => {
    const price = Number(form.prices[item.id]);
    const quantity = Number(item.quantity);
    const lineTotal = Number.isFinite(price) && Number.isFinite(quantity) ? round2(price * quantity) : 0;
    return { item, price, lineTotal };
  });

  const subtotal = round2(linePreviews.reduce((sum, line) => sum + line.lineTotal, 0));
  const taxPercent = Number(form.taxPercent) || 0;
  const taxAmount = round2((subtotal * taxPercent) / 100);
  const shipping = Number(form.shippingAmount) || 0;
  const total = round2(subtotal + taxAmount + shipping);

  function setPrice(itemId: number, value: string) {
    setForm((current) => ({ ...current, prices: { ...current.prices, [itemId]: value } }));
    setErrors((current) => ({ ...current, [`price-${itemId}`]: "" }));
  }

  function validate() {
    const next: Record<string, string> = {};
    for (const item of rfq.items) {
      const raw = (form.prices[item.id] ?? "").trim();
      if (raw === "") {
        next[`price-${item.id}`] = "Enter a unit price.";
        continue;
      }
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) next[`price-${item.id}`] = "Enter a valid, non-negative price.";
      else if (/\.\d{3,}$/.test(raw)) next[`price-${item.id}`] = "Use at most 2 decimal places.";
      else if (value > 1_000_000_000) next[`price-${item.id}`] = "Price is too large.";
    }

    const days = Number(form.deliveryDays);
    if (!Number.isInteger(days) || days < 0) next.deliveryDays = "Enter a whole number of days (0 or more).";
    else if (days > 3650) next.deliveryDays = "Delivery timeline is too long.";

    const tax = Number(form.taxPercent);
    if (form.taxPercent.trim() === "" || !Number.isFinite(tax) || tax < 0 || tax > 100) {
      next.taxPercent = "Tax must be between 0 and 100.";
    } else if (/\.\d{3,}$/.test(form.taxPercent.trim())) {
      next.taxPercent = "Use at most 2 decimal places.";
    }

    const shippingValue = Number(form.shippingAmount);
    if (form.shippingAmount.trim() === "" || !Number.isFinite(shippingValue) || shippingValue < 0) {
      next.shippingAmount = "Enter a delivery charge of 0 or more.";
    } else if (/\.\d{3,}$/.test(form.shippingAmount.trim())) {
      next.shippingAmount = "Use at most 2 decimal places.";
    }

    setErrors(next);
    return next;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    const next = validate();
    if (Object.keys(next).length > 0) {
      document.getElementById("quotation-errors")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const payload: QuotationPayload = {
      deliveryDays: Number(form.deliveryDays),
      deliveryTerms: form.deliveryTerms.trim(),
      notes: form.notes.trim(),
      taxPercent: form.taxPercent.trim(),
      shippingAmount: form.shippingAmount.trim(),
      // Currency, totals and the vendor id are never sent: the server derives
      // them from the RFQ and the authenticated vendor.
      items: rfq.items.map((item) => ({ rfqItemId: item.id, unitPrice: form.prices[item.id].trim() })),
    };

    try {
      const result = await submit.mutateAsync(payload);
      toast.success(
        quotation ? "Quotation revised" : "Quotation submitted",
        result.message ?? `${rfq.reference} now has your pricing.`,
      );
      navigate(`/rfqs/${rfq.id}`, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      setSubmitError(errorMessage(error));
    }
  }

  const deadline = deadlineMeta(rfq.deadline);
  const errorCount = Object.keys(errors).filter((key) => errors[key]).length;

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-5 lg:grid-cols-3">
      <div className="min-w-0 space-y-5 lg:col-span-2">
        {submitError || errorCount > 0 ? (
          <div
            id="quotation-errors"
            role="alert"
            className="rounded-xl border border-danger/30 border-l-4 border-l-danger bg-danger-soft px-4 py-3 text-[12px] font-medium text-danger"
          >
            <p className="flex items-center gap-2 font-bold">
              <AlertCircle size={14} aria-hidden />
              {submitError ?? `Please fix ${errorCount} field${errorCount === 1 ? "" : "s"}.`}
            </p>
          </div>
        ) : null}

        <Card className="overflow-hidden">
          <div className="border-b border-line bg-slate-50/50 px-5 py-3.5">
            <h2 className="text-[13px] font-bold text-ink">Price the requested items</h2>
            <p className="text-[11px] text-muted">
              Enter your unit price in {rfq.currency}. Line totals are calculated by the server from the requested quantities.
            </p>
          </div>
          <div className="p-5">
            <div className="hidden gap-3 border-b border-line pb-2 text-[10px] font-bold uppercase tracking-[0.07em] text-muted md:grid md:grid-cols-12">
              <span className="md:col-span-5">Requested item</span>
              <span className="md:col-span-2">Quantity</span>
              <span className="md:col-span-3">Unit price ({rfq.currency})</span>
              <span className="md:col-span-2 text-right">Line total</span>
            </div>
            <div className="divide-y divide-line/70">
              {rfq.items.map((item, index) => (
                <div key={item.id} className="grid gap-2 py-3.5 md:grid-cols-12 md:items-start">
                  <div className="min-w-0 md:col-span-5">
                    <p className="text-[12px] font-bold text-ink">
                      {index + 1}. {item.description}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">{item.specifications || "No specifications provided"}</p>
                  </div>
                  <p className="text-[12px] font-semibold text-ink-soft md:col-span-2 md:pt-2">
                    {item.quantity} <span className="font-medium text-muted">{item.unit}</span>
                  </p>
                  <div className="md:col-span-3">
                    <span className="label md:hidden">Unit price ({rfq.currency})</span>
                    <Field error={errors[`price-${item.id}`]}>
                      <Input
                        id={`price-${item.id}`}
                        aria-label={`Unit price for ${item.description}`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={form.prices[item.id] ?? ""}
                        onChange={(event) => setPrice(item.id, event.target.value)}
                        invalid={Boolean(errors[`price-${item.id}`])}
                        placeholder="0.00"
                        className="input-sm"
                      />
                    </Field>
                  </div>
                  <p className="text-[12px] font-bold text-ink md:col-span-2 md:pt-2 md:text-right">
                    {formatMoney(linePreviews[index].lineTotal, rfq.currency)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-line bg-slate-50/50 px-5 py-3.5">
            <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
              <Truck size={15} className="text-brand-600" /> Delivery &amp; terms
            </h2>
            <p className="text-[11px] text-muted">These details appear alongside your total in the comparison.</p>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field
              label="Delivery timeline (days)"
              htmlFor="delivery-days"
              required
              error={errors.deliveryDays}
              hint="Calendar days from purchase order to delivery."
            >
              <Input
                id="delivery-days"
                type="number"
                min={0}
                step={1}
                value={form.deliveryDays}
                onChange={(event) => {
                  setForm((current) => ({ ...current, deliveryDays: event.target.value }));
                  setErrors((current) => ({ ...current, deliveryDays: "" }));
                }}
                invalid={Boolean(errors.deliveryDays)}
              />
            </Field>
            <Field label="Delivery terms" htmlFor="delivery-terms" error={errors.deliveryTerms} hint="e.g. Ex-works, freight included.">
              <Input
                id="delivery-terms"
                value={form.deliveryTerms}
                onChange={(event) => setForm((current) => ({ ...current, deliveryTerms: event.target.value }))}
                placeholder="Freight included, delivered to Bengaluru"
                maxLength={240}
              />
            </Field>
            <Field
              label="Tax / GST (%)"
              htmlFor="tax-percent"
              error={errors.taxPercent}
              hint="Applied by the server to the line subtotal."
            >
              <Input
                id="tax-percent"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={form.taxPercent}
                onChange={(event) => {
                  setForm((current) => ({ ...current, taxPercent: event.target.value }));
                  setErrors((current) => ({ ...current, taxPercent: "" }));
                }}
                invalid={Boolean(errors.taxPercent)}
              />
            </Field>
            <Field
              label={`Delivery / shipping charge (${rfq.currency})`}
              htmlFor="shipping-amount"
              error={errors.shippingAmount}
              hint="Use 0 if delivery is already included in the unit prices."
            >
              <Input
                id="shipping-amount"
                type="number"
                min={0}
                step="0.01"
                value={form.shippingAmount}
                onChange={(event) => {
                  setForm((current) => ({ ...current, shippingAmount: event.target.value }));
                  setErrors((current) => ({ ...current, shippingAmount: "" }));
                }}
                invalid={Boolean(errors.shippingAmount)}
              />
            </Field>
            <Field label="Notes for procurement" htmlFor="quotation-notes" className="sm:col-span-2">
              <Textarea
                id="quotation-notes"
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Assumptions, warranty, payment terms or validity of this quotation…"
                rows={3}
                maxLength={2000}
              />
            </Field>
          </div>
        </Card>
      </div>

      <div className="min-w-0 space-y-4">
        <Card className="p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Quotation total</p>
          <p className="mt-1 text-[26px] font-extrabold tracking-tight text-ink">{formatMoney(total, rfq.currency)}</p>
          <p className="mt-1 text-[11px] text-muted">
            Preview only — the server recalculates every amount with fixed-point decimal arithmetic on submit.
          </p>
          <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-[12px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Subtotal</dt>
              <dd className="font-semibold text-ink">{formatMoney(subtotal, rfq.currency)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Tax ({taxPercent || 0}%)</dt>
              <dd className="font-semibold text-ink">{formatMoney(taxAmount, rfq.currency)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Delivery</dt>
              <dd className="font-semibold text-ink">{formatMoney(shipping, rfq.currency)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-line pt-1.5">
              <dt className="font-bold text-ink">Total</dt>
              <dd className="font-bold text-ink">{formatMoney(total, rfq.currency)}</dd>
            </div>
          </dl>
          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-600">
            <Coins size={12} className="mt-0.5 shrink-0" />
            Quoted in {rfq.currency}. Comparison uses this total, including tax and delivery.
          </p>
          <Button type="submit" className="mt-4 w-full justify-center" loading={submit.isPending} icon={<Send size={14} />}>
            {quotation ? "Submit revision" : "Submit quotation"}
          </Button>
          <Link to={`/rfqs/${rfq.id}`} className="btn btn-ghost btn-sm mt-2 w-full justify-center">
            Cancel
          </Link>
        </Card>

        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-ink">
            <CalendarClock size={14} className="text-brand-600" /> {rfq.reference}
          </p>
          <p className="mt-1 text-[11px] text-muted">Deadline {formatDateTime(rfq.deadline)}</p>
          <p className={`mt-0.5 text-[11px] font-semibold ${deadline.expired ? "text-orange-600" : "text-emerald-600"}`}>
            {deadline.label}
          </p>
          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
            <Lock size={12} className="mt-0.5 shrink-0" />
            One quotation per vendor. Submitting again before the deadline replaces the previous revision; earlier revisions
            are not retained.
          </p>
        </Card>
      </div>
    </form>
  );
}

export default function RfqQuotation() {
  const { id } = useParams();
  const rfqId = Number(id);
  const detail = useApi<RfqDetailResponse>(Number.isInteger(rfqId) ? `/rfqs/${rfqId}` : null);

  if (detail.loading) {
    return (
      <div className="page-shell">
        <SkeletonBlock className="mb-4 h-5 w-40" />
        <SkeletonBlock className="mb-6 h-9 w-96" />
        <SkeletonBlock className="h-80" />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div className="page-shell">
        <Link to="/rfqs" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-brand-600">
          <ArrowLeft size={14} /> Back to RFQs
        </Link>
        <PageHeader eyebrow="Quotation" title="Submit quotation" />
        <ErrorState message={detail.error?.message ?? "This RFQ could not be loaded."} onRetry={detail.refetch} />
      </div>
    );
  }

  const { rfq, myQuotation, submission } = detail.data;

  if (submission && !submission.canSubmit) {
    return (
      <div className="page-shell">
        <Link to={`/rfqs/${rfq.id}`} className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-brand-600">
          <ArrowLeft size={14} /> Back to RFQ
        </Link>
        <PageHeader eyebrow={rfq.reference} title="Quotation locked" description={`${rfq.title} · ${rfq.currency}`} />
        <Card className="mx-auto max-w-xl p-8 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-200 bg-orange-50 text-orange-600">
            <Lock size={20} aria-hidden />
          </span>
          <p className="text-[14px] font-bold text-ink">This RFQ is not accepting quotations</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[12px] leading-relaxed text-muted">
            {submission.reason ?? "The quotation window has closed."}
          </p>
          {myQuotation ? (
            <p className="mt-3 text-[12px] text-muted">
              Your submitted total:{" "}
              <span className="font-bold text-ink">{formatMoney(myQuotation.total, myQuotation.currency)}</span>
            </p>
          ) : null}
          <Link to={`/rfqs/${rfq.id}`} className="btn btn-ghost btn-sm mt-5 inline-flex">
            View RFQ
          </Link>
        </Card>
      </div>
    );
  }

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
              <Badge status={myQuotation ? "Submitted" : "Awaiting"} />
            </span>
          }
          title={myQuotation ? "Revise your quotation" : "Submit your quotation"}
          description={`${rfq.title} · quoted in ${rfq.currency} · deadline ${formatDateTime(rfq.deadline)}`}
        />
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3 text-[12px] text-slate-600">
          <Info size={14} className="text-brand-600" aria-hidden />
          Every requested item must be priced. Your quotation is visible to procurement only — never to other vendors.
        </div>
        <QuotationForm key={myQuotation?.id ?? "new"} rfq={rfq} quotation={myQuotation} />
      </div>
    </Page>
  );
}
