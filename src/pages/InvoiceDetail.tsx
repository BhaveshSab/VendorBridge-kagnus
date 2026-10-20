import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Download,
  Mail,
  Printer,
  ReceiptText,
  Send,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { InvoiceSheet } from "../components/InvoiceSheet";
import { Page } from "../components/guards";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  PageHeader,
  SkeletonBlock,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api, downloadDocument, errorMessage } from "../lib/api";
import { formatDate, formatDateTime } from "../lib/format";
import type { InvoiceDetailResponse, InvoiceEvent } from "../lib/types";
import { useApi, useApiMutation } from "../lib/useApi";

const EMAIL_LABEL: Record<string, string> = {
  not_sent: "Not sent",
  sent: "Sent",
  failed: "Failed",
  not_configured: "Not configured",
};

function eventIcon(type: InvoiceEvent["type"]) {
  if (type === "email_sent") return <Send size={13} className="text-emerald-600" />;
  if (type === "email_failed") return <XCircle size={13} className="text-rose-600" />;
  if (type === "email_not_configured") return <AlertTriangle size={13} className="text-amber-600" />;
  return <ReceiptText size={13} className="text-brand-600" />;
}

function eventLabel(type: InvoiceEvent["type"]) {
  if (type === "email_sent") return "Invoice emailed";
  if (type === "email_failed") return "Email delivery failed";
  if (type === "email_not_configured") return "Email not configured";
  return "Invoice generated";
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const invoiceId = Number(id);
  const toast = useToast();
  const { user } = useAuth();
  const isVendor = user?.role === "vendor";
  const [downloading, setDownloading] = useState(false);

  const data = useApi<InvoiceDetailResponse>(Number.isInteger(invoiceId) ? `/invoices/${invoiceId}` : null);

  const send = useApiMutation(() => api.post(`/invoices/${invoiceId}/send`), {
    invalidate: ["/invoices", "/purchase-orders"],
  });

  const invoice = data.data?.invoice ?? null;

  if (data.loading) {
    return (
      <div className="page-shell">
        <SkeletonBlock className="mb-4 h-5 w-40" />
        <SkeletonBlock className="mb-6 h-9 w-80" />
        <SkeletonBlock className="h-96" />
      </div>
    );
  }

  if (data.error || !invoice) {
    return (
      <div className="page-shell">
        <Link to="/invoices" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-brand-600">
          <ArrowLeft size={14} /> Back to invoices
        </Link>
        <PageHeader eyebrow="Invoice" title="Invoice" />
        <ErrorState message={data.error?.message ?? "This invoice could not be loaded."} onRetry={data.refetch} />
      </div>
    );
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const filename = await downloadDocument(`/invoices/${invoiceId}/pdf`);
      toast.success("Invoice downloaded", filename);
    } catch (error) {
      toast.error("Download failed", errorMessage(error));
    } finally {
      setDownloading(false);
    }
  }

  async function handleSend() {
    if (!invoice) return;
    try {
      await send.mutateAsync();
      toast.success("Invoice emailed", `Sent to the vendor address on file for ${invoice.vendor.name}.`);
      data.refetch();
    } catch (error) {
      toast.error("The invoice was not emailed", errorMessage(error));
      data.refetch();
    }
  }

  return (
    <Page>
      <div className="page-shell">
        <Link to="/invoices" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-brand-600">
          <ArrowLeft size={14} /> Back to invoices
        </Link>

        <PageHeader
          eyebrow={
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                {invoice.number}
              </span>
              <Badge status={EMAIL_LABEL[invoice.email.status] ?? invoice.email.status} />
            </span>
          }
          title="Pro forma invoice"
          description={`${invoice.vendor.name ?? "Vendor"} · issued ${formatDate(invoice.issueDate)}${
            invoice.purchaseOrder ? ` · ${invoice.purchaseOrder.number}` : ""
          }`}
          actions={
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={<Download size={13} />}
                loading={downloading}
                onClick={handleDownload}
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
              {data.data?.actions.canSend ? (
                <Button size="sm" icon={<Mail size={13} />} loading={send.isPending} onClick={handleSend}>
                  {invoice.email.status === "sent" ? "Resend email" : "Send to vendor"}
                </Button>
              ) : null}
            </>
          }
        />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
          <div className="min-w-0">
            <InvoiceSheet invoice={invoice} />
          </div>

          <div className="min-w-0 space-y-4">
            <Card className="overflow-hidden">
              <div className="border-b border-line bg-slate-50/60 px-4 py-3.5">
                <h2 className="text-[13px] font-bold text-ink">Email delivery</h2>
                <p className="text-[11px] text-muted">Only the vendor address on the purchase order is used.</p>
              </div>
              <div className="space-y-3 px-4 py-4 text-[12px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted">Status</span>
                  <Badge status={EMAIL_LABEL[invoice.email.status] ?? invoice.email.status} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted">Provider</span>
                  <span className="font-semibold text-ink">{invoice.email.provider ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted">Last sent</span>
                  <span className="font-semibold text-ink">
                    {invoice.email.sentAt ? formatDateTime(invoice.email.sentAt) : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted">Attempts</span>
                  <span className="font-semibold text-ink">{invoice.email.attempts}</span>
                </div>
                {isVendor ? null : invoice.vendor.email ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">Recipient</span>
                    <span className="truncate font-semibold text-ink">{invoice.vendor.email}</span>
                  </div>
                ) : null}

                {invoice.email.status === "failed" && invoice.email.error ? (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] leading-relaxed text-rose-700">
                    {invoice.email.error}
                  </p>
                ) : null}

                {data.data?.actions.emailConfigured === false ? (
                  <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    No email provider is configured. The invoice is saved, but sending returns an explicit
                    not-configured result instead of claiming success.
                  </p>
                ) : null}

                <p className="text-[10px] leading-relaxed text-muted">
                  A retry creates an audit entry and updates the delivery state — it never creates a second invoice.
                </p>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-line bg-slate-50/60 px-4 py-3.5">
                <h2 className="text-[13px] font-bold text-ink">Document history</h2>
                <p className="text-[11px] text-muted">Generation and delivery events.</p>
              </div>
              <ol className="space-y-3 px-4 py-4">
                {(invoice.timeline ?? []).map((event) => (
                  <li key={event.id} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white">
                      {eventIcon(event.type)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-ink">{eventLabel(event.type)}</p>
                      <p className="text-[10px] text-muted">{formatDateTime(event.createdAt)}</p>
                      {event.detail ? (
                        <p className="mt-0.5 text-[10px] leading-relaxed text-muted">{event.detail}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </Card>

            {invoice.purchaseOrder ? (
              <Card className="px-4 py-3.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Source purchase order</p>
                <Link
                  to={`/purchase-orders/${invoice.purchaseOrder.id}`}
                  className="mt-1 inline-flex items-center gap-1 font-mono text-[13px] font-bold text-brand-700 hover:underline"
                >
                  {invoice.purchaseOrder.number} <ArrowRight size={12} />
                </Link>
                <p className="mt-0.5 text-[11px] text-muted">
                  RFQ {invoice.rfq.reference ?? "—"} · quotation revision {invoice.quotationRevision ?? "—"}
                </p>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </Page>
  );
}
