import { ArrowLeft, Printer } from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { InvoiceSheet } from "../components/InvoiceSheet";
import { Button, ErrorState, SkeletonBlock } from "../components/ui";
import { formatDate } from "../lib/format";
import type { InvoiceDetailResponse } from "../lib/types";
import { useApi } from "../lib/useApi";

/**
 * Standalone print view. It renders outside the application shell so the print
 * dialog only ever sees the document, and it uses the same persisted invoice as
 * the API and the PDF.
 */
export default function InvoicePrint() {
  const { id } = useParams();
  const location = useLocation();
  const invoiceId = Number(id);
  const data = useApi<InvoiceDetailResponse>(Number.isInteger(invoiceId) ? `/invoices/${invoiceId}` : null);

  const auto = new URLSearchParams(location.search).get("auto") === "1";

  useEffect(() => {
    if (!data.data || !auto) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        await document.fonts.ready;
      } catch {
        // Font loading is best-effort; print anyway.
      }
      if (!cancelled) window.print();
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [data.data, auto]);

  return (
    <div className="print-shell min-h-screen bg-white px-4 py-6 sm:px-8">
      <div className="no-print mx-auto mb-4 flex max-w-[820px] flex-wrap items-center justify-between gap-3">
        <Link to="/invoices" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-brand-600">
          <ArrowLeft size={14} /> Back to invoices
        </Link>
        <div className="flex items-center gap-2">
          {data.data ? (
            <span className="text-[11px] text-muted">
              {data.data.invoice.number} · issued {formatDate(data.data.invoice.issueDate)}
            </span>
          ) : null}
          <Button size="sm" icon={<Printer size={13} />} onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-[820px]">
        {data.loading ? (
          <SkeletonBlock className="h-[600px]" />
        ) : data.error || !data.data ? (
          <ErrorState
            message={data.error?.message ?? "This invoice could not be loaded."}
            onRetry={data.refetch}
          />
        ) : (
          <InvoiceSheet invoice={data.data.invoice} />
        )}
      </div>
    </div>
  );
}
