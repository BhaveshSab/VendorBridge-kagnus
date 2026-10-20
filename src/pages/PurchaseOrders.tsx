import { ArrowRight, FileText, ReceiptText } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Page } from "../components/guards";
import {
  Badge,
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
import { formatDate, formatMoney } from "../lib/format";
import type { InvoiceEmailStatus, PurchaseOrderListResponse } from "../lib/types";
import { useApi } from "../lib/useApi";
import { useDebounced } from "../lib/useDebounced";

const EMAIL_LABEL: Record<InvoiceEmailStatus, string> = {
  not_sent: "Not sent",
  sent: "Sent",
  failed: "Failed",
  not_configured: "Not configured",
};

export default function PurchaseOrders() {
  const { user } = useAuth();
  const isVendor = user?.role === "vendor";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search, 300);

  const data = useApi<PurchaseOrderListResponse>("/purchase-orders", {
    search: debouncedSearch,
    status,
    page,
    pageSize: 10,
  });

  const total = data.data?.total ?? 0;
  const pageSize = data.data?.pageSize ?? 10;

  return (
    <Page>
      <div className="page-shell">
        <PageHeader
          eyebrow="Procurement documents"
          title="Purchase orders"
          description={
            isVendor
              ? "Purchase orders raised against your approved quotations."
              : "Generated from an approved quotation. Values copy the approved snapshot and can no longer be edited."
          }
          actions={
            <Link to="/invoices" className="btn btn-ghost btn-sm">
              <ReceiptText size={14} /> Invoices
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
            placeholder="Search PO number, RFQ or vendor…"
            className="w-full sm:w-80"
          />
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by purchase order status"
            className="input-sm w-auto font-medium"
          >
            <option value="all">All statuses</option>
            <option value="issued">Issued</option>
            <option value="cancelled">Cancelled</option>
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
              icon={<FileText size={22} />}
              title="No purchase orders yet"
              description={
                isVendor
                  ? "A purchase order appears here once procurement converts your approved quotation."
                  : "Approve a quotation first, then generate a purchase order from the approval screen."
              }
              action={
                isVendor ? undefined : (
                  <Link to="/approvals" className="btn btn-primary btn-sm">
                    Go to approvals <ArrowRight size={14} />
                  </Link>
                )
              }
            />
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Purchase order</th>
                    <th>{isVendor ? "Source RFQ" : "Vendor"}</th>
                    <th className="hidden md:table-cell">Issued</th>
                    <th className="hidden lg:table-cell">Invoice</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data?.items.map((po) => (
                    <tr key={po.id}>
                      <td>
                        <Link to={`/purchase-orders/${po.id}`} className="group flex items-center gap-2">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-200/60 bg-gradient-to-tr from-brand-50 to-indigo-50 text-brand-700">
                            <FileText size={14} aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="block font-mono text-[12px] font-bold text-ink group-hover:text-brand-700">
                              {po.number}
                            </span>
                            <span className="block truncate text-[10px] text-muted">
                              rev {po.quotationRevision ?? "—"} · {po.rfq.reference ?? "—"}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <p className="truncate text-[12px] font-semibold text-ink">{po.vendor.name ?? "—"}</p>
                        <p className="font-mono text-[10px] text-muted">{po.vendor.code ?? "—"}</p>
                      </td>
                      <td className="hidden text-[11px] text-muted md:table-cell">{formatDate(po.issuedAt)}</td>
                      <td className="hidden lg:table-cell">
                        {po.invoice ? (
                          <Link to={`/invoices/${po.invoice.id}`} className="font-mono text-[11px] font-semibold text-brand-700 hover:underline">
                            {po.invoice.number}
                          </Link>
                        ) : (
                          <span className="text-[11px] text-muted">Not invoiced</span>
                        )}
                        {po.invoice ? (
                          <p className="text-[10px] text-muted">
                            {EMAIL_LABEL[po.invoice.emailStatus] ?? po.invoice.emailStatus}
                          </p>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap text-right text-[12px] font-bold text-ink">
                        {formatMoney(po.total, po.currency)}
                      </td>
                      <td className="text-right">
                        <Badge status={po.status === "issued" ? "Issued" : "Cancelled"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {total > 0 ? (
            <Pagination page={data.data?.page ?? 1} pageSize={pageSize} total={total} onPageChange={setPage} />
          ) : null}
        </Card>
      </div>
    </Page>
  );
}
