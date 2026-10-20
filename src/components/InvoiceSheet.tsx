import { formatDate, formatDateTime, formatMoney } from "../lib/format";
import type { Invoice } from "../lib/types";
import { cn } from "./ui";

/**
 * The invoice as a document. Used by the invoice page, the purchase-order
 * screen and the dedicated print route, so what a user prints is exactly what
 * the API persisted (and what the server-side PDF renders).
 */
export function InvoiceSheet({ invoice, className }: { invoice: Invoice; className?: string }) {
  const taxLabel = `Tax (${Number(invoice.taxPercent).toFixed(2)}%)`;

  return (
    <article
      className={cn(
        "print-sheet overflow-hidden rounded-card border border-slate-200 bg-white shadow-sm",
        className,
      )}
      aria-label={`Invoice ${invoice.number}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-[13px] font-extrabold tracking-tight text-white shadow-md shadow-blue-500/25">
            VB
          </span>
          <div>
            <p className="text-[15px] font-bold tracking-tight text-ink">VendorBridge</p>
            <p className="text-[11px] text-muted">Procurement &amp; vendor operations</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-700">
            System-generated pro forma invoice
          </p>
          <p className="mt-1 font-mono text-[20px] font-extrabold tracking-tight text-ink">{invoice.number}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            Issued {formatDate(invoice.issueDate)}
            {invoice.dueDate ? ` · due ${formatDate(invoice.dueDate)}` : " · due on receipt"}
          </p>
        </div>
      </header>

      <div className="grid gap-6 border-b border-slate-200 px-6 py-5 sm:grid-cols-2 sm:px-8">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Supplier</p>
          <p className="mt-1.5 text-[14px] font-bold text-ink">{invoice.vendor.name ?? "Vendor"}</p>
          {invoice.vendor.code ? (
            <p className="font-mono text-[11px] text-muted">{invoice.vendor.code}</p>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:justify-items-end">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Purchase order</dt>
            <dd className="mt-0.5 font-mono text-[12px] font-semibold text-ink">
              {invoice.purchaseOrder?.number ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">RFQ reference</dt>
            <dd className="mt-0.5 font-mono text-[12px] font-semibold text-ink">{invoice.rfq.reference ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Quotation revision</dt>
            <dd className="mt-0.5 text-[12px] font-semibold text-ink">
              {invoice.quotationRevision ? `R${invoice.quotationRevision}` : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Currency</dt>
            <dd className="mt-0.5 text-[12px] font-semibold text-ink">{invoice.currency}</dd>
          </div>
        </dl>
      </div>

      <div className="px-6 py-5 sm:px-8">
        <div className="overflow-x-auto">
          <table className="table min-w-[560px]">
            <caption className="sr-only">Invoice line items</caption>
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
              {invoice.items.map((line) => (
                <tr key={line.id ?? line.position}>
                  <td className="text-[11px] font-bold text-muted">{line.position}</td>
                  <td className="text-[12px] font-semibold text-ink">{line.description}</td>
                  <td className="whitespace-nowrap text-right text-[12px] text-ink-soft">
                    {line.quantity} <span className="text-[11px] text-muted">{line.unit}</span>
                  </td>
                  <td className="whitespace-nowrap text-right text-[12px] text-ink-soft">
                    {formatMoney(line.unitPrice, invoice.currency)}
                  </td>
                  <td className="whitespace-nowrap text-right text-[12px] font-bold text-ink">
                    {formatMoney(line.lineTotal, invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto mt-5 max-w-xs space-y-1.5 text-[12px]">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Subtotal</dt>
            <dd className="font-semibold text-ink">{formatMoney(invoice.subtotal, invoice.currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{taxLabel}</dt>
            <dd className="font-semibold text-ink">{formatMoney(invoice.taxAmount, invoice.currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Delivery</dt>
            <dd className="font-semibold text-ink">{formatMoney(invoice.shippingAmount, invoice.currency)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2">
            <dt className="text-[12px] font-bold text-ink">Total due</dt>
            <dd className="text-[18px] font-extrabold tracking-tight text-ink">
              {formatMoney(invoice.total, invoice.currency)}
            </dd>
          </div>
        </dl>
      </div>

      <footer className="border-t border-slate-200 bg-slate-50/60 px-6 py-4 text-[10px] leading-relaxed text-muted sm:px-8">
        <p>
          Tax and delivery charges carry over from the approved quotation and are calculated once on the subtotal.
        </p>
        <p className="mt-1">
          Generated by VendorBridge from persisted approval, purchase order and invoice records
          {invoice.createdBy ? ` by ${invoice.createdBy}` : ""} · {formatDateTime(invoice.createdAt)}. This is an
          internal pro forma document and does not replace a vendor-issued tax invoice.
        </p>
      </footer>
    </article>
  );
}
