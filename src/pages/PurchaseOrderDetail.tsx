import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  CheckCircle2,
  Download,
  FileText,
  Mail,
  Printer,
  ReceiptText,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Page } from "../components/guards";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  SkeletonBlock,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api, downloadDocument, errorMessage } from "../lib/api";
import { formatDate, formatDateTime, formatMoney } from "../lib/format";
import type { Invoice, InvoiceDetailResponse, PurchaseOrderResponse } from "../lib/types";
import { useApi, useApiMutation } from "../lib/useApi";

const EMAIL_LABEL: Record<string, string> = {
  not_sent: "Not sent",
  sent: "Sent",
  failed: "Failed",
  not_configured: "Not configured",
};

function defaultDueDate() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const poId = Number(id);
  const toast = useToast();
  const { user } = useAuth();
  const isVendor = user?.role === "vendor";
  const isStaff = user?.role !== "vendor";

  const [invoiceModal, setInvoiceModal] = useState(false);
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const data = useApi<PurchaseOrderResponse>(Number.isInteger(poId) ? `/purchase-orders/${poId}` : null);
  const invoiceDetail = useApi<InvoiceDetailResponse>(
    data.data?.purchaseOrder.invoice ? `/invoices/${data.data.purchaseOrder.invoice.id}` : null,
  );

  const generateInvoice = useApiMutation(
    (input: { purchaseOrderId: number; dueDate: string }) => api.post<{ invoice: Invoice }>("/invoices", input),
    { invalidate: ["/purchase-orders", "/invoices", "/dashboard"] },
  );

  const sendInvoice = useApiMutation(
    (invoiceId: number) => api.post(`/invoices/${invoiceId}/send`),
    { invalidate: ["/purchase-orders", "/invoices"] },
  );

  const cancelPo = useApiMutation(
    (input: { id: number; reason: string }) => api.post(`/purchase-orders/${input.id}/cancel`, { reason: input.reason }),
    { invalidate: ["/purchase-orders", "/approvals", "/dashboard"] },
  );

  const po = data.data?.purchaseOrder ?? null;
  const actions = data.data?.actions;
  const invoice = po?.invoice ?? null;
  const emailConfigured = invoiceDetail.data?.actions.emailConfigured;

  const emailTone = useMemo(() => {
    const status = invoice?.emailStatus;
    if (status === "sent") return "text-emerald-700";
    if (status === "failed") return "text-rose-700";
    return "text-muted";
  }, [invoice?.emailStatus]);

  if (data.loading) {
    return (
      <div className="page-shell">
        <SkeletonBlock className="mb-4 h-5 w-40" />
        <SkeletonBlock className="mb-6 h-9 w-80" />
        <SkeletonBlock className="h-96" />
      </div>
    );
  }

  if (data.error || !po) {
    return (
      <div className="page-shell">
        <Link to="/purchase-orders" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-brand-600">
          <ArrowLeft size={14} /> Back to purchase orders
        </Link>
        <PageHeader eyebrow="Purchase order" title="Purchase order" />
        <ErrorState message={data.error?.message ?? "This purchase order could not be loaded."} onRetry={data.refetch} />
      </div>
    );
  }

  async function handleGenerateInvoice() {
    if (!po) return;
    try {
      const result = await generateInvoice.mutateAsync({ purchaseOrderId: po.id, dueDate });
      setInvoiceModal(false);
      toast.success("Invoice generated", `${result.invoice.number} was created from ${po.number}.`);
      data.refetch();
    } catch (error) {
      toast.error("The invoice was not generated", errorMessage(error));
    }
  }

  async function handleSendInvoice(invoiceId: number) {
    if (!po) return;
    try {
      await sendInvoice.mutateAsync(invoiceId);
      toast.success("Invoice emailed", `Sent to the vendor address on file for ${po.vendor.name}.`);
      data.refetch();
      invoiceDetail.refetch();
    } catch (error) {
      toast.error("The invoice was not emailed", errorMessage(error));
      data.refetch();
      invoiceDetail.refetch();
    }
  }

  async function handleCancel() {
    if (!po) return;
    try {
      await cancelPo.mutateAsync({ id: po.id, reason: cancelReason });
      setCancelOpen(false);
      setCancelReason("");
      toast.success("Purchase order cancelled", `${po.number} can no longer be invoiced.`);
      data.refetch();
    } catch (error) {
      toast.error("The purchase order was not cancelled", errorMessage(error));
    }
  }

  return (
    <Page>
      <div className="page-shell">
        <Link to="/purchase-orders" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-brand-600">
          <ArrowLeft size={14} /> Back to purchase orders
        </Link>

        <PageHeader
          eyebrow={
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                {po.number}
              </span>
              <Badge status={po.status === "issued" ? "Issued" : "Cancelled"} />
            </span>
          }
          title="Purchase order & invoice"
          description={`${po.vendor.name ?? "Vendor"} · issued ${formatDate(po.issuedAt)} · source ${po.rfq.reference ?? "RFQ"}`}
          actions={
            <>
              {invoice ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Download size={13} />}
                    onClick={async () => {
                      try {
                        await downloadDocument(`/invoices/${invoice.id}/pdf`);
                      } catch (error) {
                        toast.error("Download failed", errorMessage(error));
                      }
                    }}
                  >
                    Download PDF
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Printer size={13} />}
                    onClick={() => window.open(`/invoices/${invoice.id}/print?auto=1`, "_blank", "noopener")}
                  >
                    Print
                  </Button>
                  {!isVendor ? (
                    <Button
                      size="sm"
                      icon={<Mail size={13} />}
                      loading={sendInvoice.isPending}
                      onClick={() => handleSendInvoice(invoice.id)}
                    >
                      {invoice.emailStatus === "sent" ? "Resend email" : "Send to vendor"}
                    </Button>
                  ) : null}
                </>
              ) : actions?.canGenerateInvoice ? (
                <Button size="sm" icon={<ReceiptText size={13} />} onClick={() => setInvoiceModal(true)}>
                  Generate invoice
                </Button>
              ) : null}
              {actions?.canCancel ? (
                <Button variant="danger-ghost" size="sm" icon={<Ban size={13} />} onClick={() => setCancelOpen(true)}>
                  Cancel
                </Button>
              ) : null}
            </>
          }
        />

        {po.status === "cancelled" ? (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-800">
            <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
            <div>
              <p className="font-bold">This purchase order was cancelled {formatDate(po.cancelledAt)}</p>
              <p className="mt-0.5">{po.cancelReason ?? "No reason was recorded."}</p>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
          <article className="print-sheet overflow-hidden rounded-card border border-slate-200 bg-white shadow-sm">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-slate-800 to-slate-900 text-[13px] font-extrabold tracking-tight text-white">
                  VB
                </span>
                <div>
                  <p className="text-[15px] font-bold tracking-tight text-ink">VendorBridge</p>
                  <p className="text-[11px] text-muted">Procurement &amp; vendor operations</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Purchase order</p>
                <p className="mt-1 font-mono text-[20px] font-extrabold tracking-tight text-ink">{po.number}</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  Issued {formatDate(po.issuedAt)}
                  {po.createdBy ? ` · ${po.createdBy}` : ""}
                </p>
              </div>
            </header>

            <div className="grid gap-6 border-b border-slate-200 px-6 py-5 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Supplier</p>
                <p className="mt-1.5 text-[14px] font-bold text-ink">{po.vendor.name ?? "Vendor"}</p>
                {po.vendor.code ? <p className="font-mono text-[11px] text-muted">{po.vendor.code}</p> : null}
                {isStaff && po.vendor.email ? (
                  <p className="mt-1 text-[11px] text-muted">Invoices go to {po.vendor.email}</p>
                ) : null}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:justify-items-end">
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">RFQ reference</dt>
                  <dd className="mt-0.5 font-mono text-[12px] font-semibold text-ink">{po.rfq.reference ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Quotation revision</dt>
                  <dd className="mt-0.5 text-[12px] font-semibold text-ink">
                    {po.quotationRevision ? `R${po.quotationRevision}` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Currency</dt>
                  <dd className="mt-0.5 text-[12px] font-semibold text-ink">{po.currency}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Status</dt>
                  <dd className="mt-0.5 text-[12px] font-semibold text-ink capitalize">{po.status}</dd>
                </div>
              </dl>
            </div>

            <div className="px-6 py-5">
              <div className="overflow-x-auto">
                <table className="table min-w-[560px]">
                  <caption className="sr-only">Purchase order line items</caption>
                  <thead>
                    <tr>
                      <th className="w-8">#</th>
                      <th>Description</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Unit price</th>
                      <th className="text-right">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.items.map((line) => (
                      <tr key={line.id ?? line.position}>
                        <td className="text-[11px] font-bold text-muted">{line.position}</td>
                        <td className="text-[12px] font-semibold text-ink">{line.description}</td>
                        <td className="whitespace-nowrap text-right text-[12px] text-ink-soft">
                          {line.quantity} <span className="text-[11px] text-muted">{line.unit}</span>
                        </td>
                        <td className="whitespace-nowrap text-right text-[12px] text-ink-soft">
                          {formatMoney(line.unitPrice, po.currency)}
                        </td>
                        <td className="whitespace-nowrap text-right text-[12px] font-bold text-ink">
                          {formatMoney(line.lineTotal, po.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <dl className="ml-auto mt-5 max-w-xs space-y-1.5 text-[12px]">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Subtotal</dt>
                  <dd className="font-semibold text-ink">{formatMoney(po.subtotal, po.currency)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Tax ({Number(po.taxPercent).toFixed(2)}%)</dt>
                  <dd className="font-semibold text-ink">{formatMoney(po.taxAmount, po.currency)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Delivery</dt>
                  <dd className="font-semibold text-ink">{formatMoney(po.shippingAmount, po.currency)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2">
                  <dt className="text-[12px] font-bold text-ink">Total</dt>
                  <dd className="text-[18px] font-extrabold tracking-tight text-ink">
                    {formatMoney(po.total, po.currency)}
                  </dd>
                </div>
              </dl>
            </div>

            <footer className="border-t border-slate-200 bg-slate-50/60 px-6 py-3.5 text-[10px] leading-relaxed text-muted">
              Generated from approved quotation revision {po.quotationRevision ?? "—"} and cannot be edited. Values are
              the approved snapshot — no client-supplied amounts are used.
            </footer>
          </article>

          <div className="min-w-0 space-y-4">
            <Card className="overflow-hidden">
              <div className="flex items-start justify-between gap-2 border-b border-line bg-slate-50/60 px-4 py-3.5">
                <div>
                  <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
                    <ReceiptText size={14} className="text-brand-600" /> Invoice
                  </h2>
                  <p className="text-[11px] text-muted">
                    {invoice ? "Generated from this purchase order." : "One invoice per purchase order."}
                  </p>
                </div>
                {invoice ? <Badge status={EMAIL_LABEL[invoice.emailStatus] ?? invoice.emailStatus} /> : null}
              </div>

              {invoice ? (
                <div className="space-y-3.5 px-4 py-4">
                  <div>
                    <Link
                      to={`/invoices/${invoice.id}`}
                      className="font-mono text-[15px] font-bold text-brand-700 hover:underline"
                    >
                      {invoice.number}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-muted">
                      Issued {formatDate(invoice.issueDate)}
                      {invoice.dueDate ? ` · due ${formatDate(invoice.dueDate)}` : " · due on receipt"}
                    </p>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                    <span className="text-[11px] font-semibold text-muted">Total due</span>
                    <span className="text-[16px] font-extrabold text-ink">
                      {formatMoney(invoice.total, invoice.currency)}
                    </span>
                  </div>

                  <p className={`text-[11px] font-semibold ${emailTone}`}>
                    {invoice.emailStatus === "sent"
                      ? `Email sent ${formatDateTime(invoiceDetail.data?.invoice.email.sentAt ?? null)}`
                      : invoice.emailStatus === "failed"
                        ? "Last email attempt failed"
                        : invoice.emailStatus === "not_configured"
                          ? "Email delivery is not configured on this server"
                          : "Not emailed yet"}
                  </p>
                  {invoice.emailStatus === "failed" && invoiceDetail.data?.invoice.email.error && isStaff ? (
                    <p className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-[10px] leading-relaxed text-rose-700">
                      {invoiceDetail.data.invoice.email.error}
                    </p>
                  ) : null}

                  {emailConfigured === false && isStaff ? (
                    <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] leading-relaxed text-amber-800">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      No email provider is configured, so sending returns a not-configured result. The invoice itself
                      is saved and can still be downloaded or printed.
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Link to={`/invoices/${invoice.id}`} className="btn btn-ghost btn-sm">
                      <FileText size={13} /> Open invoice
                    </Link>
                    {!isVendor ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Mail size={13} />}
                        loading={sendInvoice.isPending}
                        onClick={() => handleSendInvoice(invoice.id)}
                      >
                        {invoice.emailStatus === "sent" ? "Resend" : "Email"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="px-4 py-6 text-center">
                  <p className="text-[12px] font-bold text-ink">No invoice generated yet</p>
                  <p className="mx-auto mt-1 max-w-[260px] text-[11px] leading-relaxed text-muted">
                    {po.status === "cancelled"
                      ? "A cancelled purchase order cannot be invoiced."
                      : actions?.canGenerateInvoice
                        ? "Generate the invoice from the saved purchase order values."
                        : "Procurement generates the invoice from this purchase order."}
                  </p>
                  {actions?.canGenerateInvoice ? (
                    <Button size="sm" className="mt-3" icon={<ReceiptText size={13} />} onClick={() => setInvoiceModal(true)}>
                      Generate invoice
                    </Button>
                  ) : null}
                </div>
              )}
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-line bg-slate-50/60 px-4 py-3.5">
                <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
                  <ShieldCheck size={14} className="text-brand-600" /> Source &amp; approval
                </h2>
                <p className="text-[11px] text-muted">The chain this document was generated from.</p>
              </div>
              <dl className="space-y-3 px-4 py-4 text-[12px]">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">RFQ</dt>
                  <dd>
                    <Link to={`/rfqs/${po.rfq.id}`} className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
                      {po.rfq.reference} <ArrowRight size={11} />
                    </Link>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Quotation revision</dt>
                  <dd className="font-semibold text-ink">{po.quotationRevision ? `R${po.quotationRevision}` : "—"}</dd>
                </div>
                {po.approval ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted">Approval</dt>
                      <dd>
                        {isStaff ? (
                          <Link
                            to={`/approvals/${po.approval.id}`}
                            className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"
                          >
                            #{po.approval.id} · {po.approval.status} <ArrowRight size={11} />
                          </Link>
                        ) : (
                          <span className="font-semibold capitalize text-ink">{po.approval.status}</span>
                        )}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted">Decided</dt>
                      <dd className="text-right font-semibold text-ink">
                        {formatDate(po.approval.decidedAt)}
                        {po.approval.decidedBy ? ` · ${po.approval.decidedBy}` : ""}
                      </dd>
                    </div>
                  </>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Currency</dt>
                  <dd className="font-semibold text-ink">{po.currency}</dd>
                </div>
              </dl>
            </Card>

            {isStaff ? (
              <p className="flex items-start gap-1.5 px-1 text-[10px] leading-relaxed text-muted">
                <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-600" />
                Purchase order, invoice and email actions are all re-authorised by the API; this screen only mirrors
                those rules.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <Modal
        open={invoiceModal}
        onClose={() => setInvoiceModal(false)}
        title={`Generate an invoice for ${po.number}?`}
        description="The invoice copies the saved purchase order values — line items, tax and delivery — without recalculating tax."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setInvoiceModal(false)} disabled={generateInvoice.isPending}>
              Cancel
            </Button>
            <Button size="sm" loading={generateInvoice.isPending} onClick={handleGenerateInvoice}>
              Generate invoice
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-[12px]">
            <div className="flex justify-between gap-3">
              <span className="text-muted">Vendor</span>
              <span className="font-semibold text-ink">{po.vendor.name}</span>
            </div>
            <div className="mt-1.5 flex justify-between gap-3">
              <span className="text-muted">Total</span>
              <span className="font-bold text-ink">{formatMoney(po.total, po.currency)}</span>
            </div>
          </div>
          <Field
            label="Due date"
            htmlFor="invoice-due-date"
            hint="Defaults to 30 days after the issue date. Cannot be earlier than today."
          >
            <Input
              id="invoice-due-date"
              type="date"
              value={dueDate}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ${po.number}?`}
        description="Cancelling is final. The purchase order and its approved quotation stay on record."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCancelOpen(false)} disabled={cancelPo.isPending}>
              Keep purchase order
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={cancelPo.isPending}
              disabled={cancelReason.trim().length < 5}
              onClick={handleCancel}
            >
              Cancel purchase order
            </Button>
          </>
        }
      >
        <Field
          label="Reason"
          htmlFor="cancel-reason"
          required
          hint="At least 5 characters — recorded on the purchase order."
        >
          <Input
            id="cancel-reason"
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            maxLength={500}
            placeholder="e.g. Vendor withdrew the offer before delivery."
          />
        </Field>
      </Modal>

    </Page>
  );
}
