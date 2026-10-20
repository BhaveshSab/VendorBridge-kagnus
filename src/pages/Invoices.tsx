import { Download, FileText, ReceiptText } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Page } from "../components/guards";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  SkeletonBlock,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { downloadDocument, errorMessage } from "../lib/api";
import { formatDate, formatMoney } from "../lib/format";
import type { InvoiceEmailStatus, InvoiceListResponse } from "../lib/types";
import { useApi } from "../lib/useApi";
import { useDebounced } from "../lib/useDebounced";

const EMAIL_LABEL: Record<InvoiceEmailStatus, string> = {
  not_sent: "Not sent",
  sent: "Sent",
  failed: "Failed",
  not_configured: "Not configured",
};

export default function Invoices() {
  const { user } = useAuth();
  const toast = useToast();
  const isVendor = user?.role === "vendor";
  const [search, setSearch] = useState("");
  const [emailStatus, setEmailStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState<number | null>(null);
  const debouncedSearch = useDebounced(search, 300);

  const data = useApi<InvoiceListResponse>("/invoices", {
    search: debouncedSearch,
    emailStatus,
    page,
    pageSize: 10,
  });

  async function download(id: number) {
    setDownloading(id);
    try {
      const filename = await downloadDocument(`/invoices/${id}/pdf`);
      toast.success("Invoice downloaded", filename);
    } catch (error) {
      toast.error("Download failed", errorMessage(error));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <Page>
      <div className="page-shell">
        <PageHeader
          eyebrow="Procurement documents"
          title="Invoices"
          description={
            isVendor
              ? "Pro forma invoices generated from purchase orders addressed to your company."
              : "Generated from a purchase order. Values carry over from the approved quotation — tax is never recalculated."
          }
          actions={
            <Link to="/purchase-orders" className="btn btn-ghost btn-sm">
              <FileText size={14} /> Purchase orders
            </Link>
          }
        />

        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search invoice, PO or vendor…"
            className="w-full sm:w-80"
          />
          <Select
            value={emailStatus}
            onChange={(event) => {
              setEmailStatus(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by email delivery status"
            className="input-sm w-auto font-medium"
          >
            <option value="all">All delivery states</option>
            <option value="not_sent">Not sent</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="not_configured">Not configured</option>
          </Select>
        </div>

        <Card className="overflow-hidden">
          {data.loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3].map((row) => (
                <SkeletonBlock key={row} className="h-12" />
              ))}
            </div>
          ) : data.error ? (
            <div className="p-4">
              <ErrorState message={data.error.message} onRetry={data.refetch} />
            </div>
          ) : (data.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon={<ReceiptText size={22} />}
              title="No invoices yet"
              description={
                isVendor
                  ? "Invoices appear here once procurement raises one against a purchase order."
                  : "Generate an invoice from an issued purchase order."
              }
              action={
                isVendor ? undefined : (
                  <Link to="/purchase-orders" className="btn btn-primary btn-sm">
                    View purchase orders
                  </Link>
                )
              }
            />
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th className="hidden sm:table-cell">Purchase order</th>
                    <th>{isVendor ? "Source RFQ" : "Vendor"}</th>
                    <th className="hidden md:table-cell">Issued</th>
                    <th className="hidden lg:table-cell">Due</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Delivery</th>
                    <th className="text-right">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data?.items.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>
                        <Link to={`/invoices/${invoice.id}`} className="font-mono text-[12px] font-bold text-ink hover:text-brand-700">
                          {invoice.number}
                        </Link>
                        <p className="text-[10px] text-muted">R{invoice.quotationRevision ?? "—"}</p>
                      </td>
                      <td className="hidden sm:table-cell">
                        {invoice.purchaseOrder ? (
                          <Link
                            to={`/purchase-orders/${invoice.purchaseOrder.id}`}
                            className="font-mono text-[11px] font-semibold text-brand-700 hover:underline"
                          >
                            {invoice.purchaseOrder.number}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <p className="truncate text-[12px] font-semibold text-ink">{invoice.vendor.name ?? "—"}</p>
                        <p className="font-mono text-[10px] text-muted">{invoice.rfq.reference ?? "—"}</p>
                      </td>
                      <td className="hidden text-[11px] text-muted md:table-cell">{formatDate(invoice.issueDate)}</td>
                      <td className="hidden text-[11px] text-muted lg:table-cell">
                        {invoice.dueDate ? formatDate(invoice.dueDate) : "On receipt"}
                      </td>
                      <td className="whitespace-nowrap text-right text-[12px] font-bold text-ink">
                        {formatMoney(invoice.total, invoice.currency)}
                      </td>
                      <td className="text-right">
                        <Badge status={EMAIL_LABEL[invoice.email.status] ?? invoice.email.status} />
                      </td>
                      <td className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Download size={13} />}
                          loading={downloading === invoice.id}
                          onClick={() => download(invoice.id)}
                          aria-label={`Download ${invoice.number} as PDF`}
                        >
                          PDF
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(data.data?.total ?? 0) > 0 ? (
            <Pagination
              page={data.data?.page ?? 1}
              pageSize={data.data?.pageSize ?? 10}
              total={data.data?.total ?? 0}
              onPageChange={setPage}
            />
          ) : null}
        </Card>
      </div>
    </Page>
  );
}
