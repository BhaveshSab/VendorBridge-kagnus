import { motion } from "framer-motion";
import {
  BarChart3,
  Building2,
  CheckCircle2,
  Clock,
  Download,
  IndianRupee,
  ReceiptText,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import { DonutChart } from "../components/charts";
import { Page } from "../components/guards";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
  SkeletonBlock,
  StatCard,
} from "../components/ui";
import { useToast } from "../context/ToastContext";
import { downloadDocument, errorMessage } from "../lib/api";
import { formatCompactMoney, formatMoney, formatNumber } from "../lib/format";
import { useApi } from "../lib/useApi";

interface CurrencyBucket {
  currency: string;
  total: string;
  orders: number;
}

interface Overview {
  range: { from: string; to: string; days: number };
  currency: string;
  currencies: CurrencyBucket[];
  totals: {
    purchaseOrders: number;
    purchaseOrderValue: string;
    allPurchaseOrders: number;
    invoices: number;
    invoiceValue: string;
    overdueInvoices: number;
    quotes: number;
    rfqsCreated: number;
    openRfqs: number;
    pendingApprovals: number;
    approvedApprovals: number;
    rejectedApprovals: number;
    decidedInRange: number;
    avgApprovalHours: number | null;
    avgOrderDays: number | null;
    activeVendors: number;
    totalVendors: number;
    newVendors: number;
  };
  spendByMonth: { month: string; label: string; currency: string; total: string; orders: number }[];
  spendByCategory: { name: string; currency: string; total: string; orders: number; share: number }[];
  topVendors: {
    id: number;
    name: string;
    code: string | null;
    category: string | null;
    currency: string;
    total: string;
    orders: number;
    share: number;
  }[];
}

interface VendorPerformance {
  range: { from: string; to: string; days: number };
  currency: string;
  rows: {
    vendorId: number;
    name: string;
    code: string;
    category: string;
    status: string;
    rating: number;
    invited: number;
    quoted: number;
    awarded: number;
    winRate: number | null;
    avgDeliveryDays: number | null;
    currency: string;
    spend: string;
    share: number;
  }[];
}

const PRESETS = [
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
  { value: "180", label: "Last 6 months", days: 180 },
  { value: "365", label: "Last 12 months", days: 365 },
];

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function rangeFor(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: isoDay(from), to: isoDay(to) };
}

function hoursLabel(value: number | null) {
  if (value == null) return "—";
  if (value < 1) return `${Math.round(value * 60)}m`;
  if (value < 24) return `${value}h`;
  return `${Math.round((value / 24) * 10) / 10}d`;
}

function SpendTrend({ months, currency }: { months: Overview["spendByMonth"]; currency: string }) {
  if (months.length === 0) {
    return <EmptyState compact title="No period selected" description="Choose a date range to see spend over time." />;
  }
  const max = Math.max(1, ...months.map((month) => Number(month.total)));
  return (
    <div className="flex h-44 items-stretch gap-2.5 px-1">
      {months.map((month) => {
        const height = Math.max(3, Math.round((Number(month.total) / max) * 100));
        return (
          <div key={month.month} className="group flex min-w-0 flex-1 flex-col items-center gap-2">
            <div className="flex w-full flex-1 items-end">
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${height}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="w-full rounded-t-md bg-gradient-to-t from-blue-600 to-indigo-400 shadow-xs hover:from-blue-700 hover:to-indigo-500"
                title={`${month.label}: ${formatMoney(month.total, currency)} · ${month.orders} order(s)`}
              />
            </div>
            <span
              className="w-full truncate text-center text-[10px] font-semibold text-muted group-hover:text-ink"
              title={`${month.label}: ${formatMoney(month.total, currency)}`}
            >
              {month.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function Reports() {
  const toast = useToast();
  const [preset, setPreset] = useState("90");
  const [exporting, setExporting] = useState<string | null>(null);

  const days = PRESETS.find((option) => option.value === preset)?.days ?? 90;
  const range = useMemo(() => rangeFor(days), [days]);

  const overview = useApi<Overview>("/reports/overview", range);
  const performance = useApi<VendorPerformance>("/reports/vendors", range);
  const data = overview.data;

  async function exportCsv(type: "spend" | "purchase-orders" | "invoices") {
    setExporting(type);
    try {
      const filename = await downloadDocument(
        `/reports/export?type=${encodeURIComponent(type)}&from=${range.from}&to=${range.to}`,
      );
      toast.success("Report exported", filename);
    } catch (error) {
      toast.error("Export failed", errorMessage(error));
    } finally {
      setExporting(null);
    }
  }

  if (overview.loading && !data) {
    return (
      <Page>
        <div className="page-shell">
          <div className="mb-6 space-y-2">
            <SkeletonBlock className="h-3 w-32" />
            <SkeletonBlock className="h-8 w-64" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <SkeletonBlock key={item} className="h-28" />
            ))}
          </div>
          <SkeletonBlock className="mt-5 h-64" />
        </div>
      </Page>
    );
  }

  if (overview.error && !data) {
    return (
      <Page>
        <div className="page-shell">
          <PageHeader eyebrow="Insights" title="Reports" />
          <ErrorState message={overview.error.message} onRetry={overview.refetch} />
        </div>
      </Page>
    );
  }

  if (!data) return null;

  const totals = data.totals;
  const otherCurrencies = data.currencies.filter((bucket) => bucket.currency !== data.currency);
  const categorySegments = data.spendByCategory.slice(0, 6).map((row) => ({
    label: row.name,
    value: Number(row.total),
  }));

  return (
    <Page>
      <div className="page-shell">
        <PageHeader
          eyebrow="Insights & governance"
          title="Reports"
          description="Spend, supplier performance and procurement cycle times for the selected period. Values follow issued purchase orders, so they can never disagree with the documents."
          actions={
            <>
              <Select
                value={preset}
                onChange={(event) => setPreset(event.target.value)}
                aria-label="Reporting period"
                className="input-sm w-auto font-semibold"
              >
                {PRESETS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => exportCsv("spend")}
                disabled={exporting !== null}
              >
                <Download size={14} />
                {exporting === "spend" ? "Exporting…" : "Export spend CSV"}
              </button>
            </>
          }
        />

        <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted">
          <span className="badge badge-open">
            {data.range.from} → {data.range.to}
          </span>
          <span>
            Reporting currency <span className="font-bold text-ink">{data.currency}</span>
          </span>
          {otherCurrencies.length > 0 ? (
            <span className="text-amber-700">
              · {otherCurrencies.reduce((sum, bucket) => sum + bucket.orders, 0)} order(s) in{" "}
              {otherCurrencies.map((bucket) => bucket.currency).join(", ")} are excluded from the breakdowns below
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => exportCsv("purchase-orders")}
              disabled={exporting !== null}
            >
              <Download size={12} /> Purchase orders
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => exportCsv("invoices")}
              disabled={exporting !== null}
            >
              <Download size={12} /> Invoices
            </button>
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Awarded spend"
            value={formatMoney(totals.purchaseOrderValue, data.currency)}
            hint={`${totals.purchaseOrders} issued purchase order${totals.purchaseOrders === 1 ? "" : "s"}`}
            icon={<IndianRupee size={18} />}
          />
          <StatCard
            label="Approval turnaround"
            value={hoursLabel(totals.avgApprovalHours)}
            hint={`${totals.decidedInRange} decision${totals.decidedInRange === 1 ? "" : "s"} in this period`}
            icon={<Clock size={18} />}
          />
          <StatCard
            label="Pending approvals"
            value={formatNumber(totals.pendingApprovals)}
            hint={`${totals.approvedApprovals} approved · ${totals.rejectedApprovals} rejected all time`}
            icon={<CheckCircle2 size={18} />}
          />
          <StatCard
            label="Invoiced value"
            value={formatMoney(totals.invoiceValue, data.currency)}
            hint={
              totals.overdueInvoices > 0
                ? `${totals.overdueInvoices} invoice(s) past due`
                : `${totals.invoices} invoice${totals.invoices === 1 ? "" : "s"} issued`
            }
            icon={<ReceiptText size={18} />}
            trend={
              totals.overdueInvoices > 0
                ? { value: `${totals.overdueInvoices} overdue`, positive: false }
                : { value: "No overdue invoices" }
            }
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">RFQs created</p>
            <p className="mt-1.5 text-[20px] font-extrabold text-ink">{formatNumber(totals.rfqsCreated)}</p>
            <p className="mt-0.5 text-[11px] text-muted">
              {totals.quotes} quotation{totals.quotes === 1 ? "" : "s"} received · {totals.openRfqs} open now
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Request → PO cycle</p>
            <p className="mt-1.5 text-[20px] font-extrabold text-ink">
              {totals.avgOrderDays == null ? "—" : `${totals.avgOrderDays} days`}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">Average time from approval request to purchase order</p>
          </Card>
          <Card className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Active suppliers</p>
            <p className="mt-1.5 text-[20px] font-extrabold text-ink">{formatNumber(totals.activeVendors)}</p>
            <p className="mt-0.5 text-[11px] text-muted">of {formatNumber(totals.totalVendors)} in the register</p>
          </Card>
          <Card className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">New suppliers</p>
            <p className="mt-1.5 text-[20px] font-extrabold text-ink">{formatNumber(totals.newVendors)}</p>
            <p className="mt-0.5 text-[11px] text-muted">onboarded in this period</p>
          </Card>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <Card className="overflow-hidden lg:col-span-2">
            <div className="flex items-center justify-between border-b border-line bg-slate-50/50 px-5 py-3.5">
              <div>
                <h2 className="flex items-center gap-1.5 text-[14px] font-bold text-ink">
                  <BarChart3 size={15} className="text-brand-600" /> Spend by month
                </h2>
                <p className="text-[11px] text-muted">Issued purchase orders in {data.currency}</p>
              </div>
              <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                <TrendingUp size={13} />
                {formatMoney(totals.purchaseOrderValue, data.currency)}
              </span>
            </div>
            <div className="px-5 pb-5 pt-6">
              <SpendTrend months={data.spendByMonth} currency={data.currency} />
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-line bg-slate-50/50 px-5 py-3.5">
              <h2 className="text-[14px] font-bold text-ink">Spend by category</h2>
              <p className="text-[11px] text-muted">Where the awarded value sits</p>
            </div>
            <div className="px-5 py-5">
              {categorySegments.length > 0 ? (
                <DonutChart
                  segments={categorySegments}
                  totalLabel="Awarded"
                  totalValue={formatCompactMoney(totals.purchaseOrderValue, data.currency)}
                  layout="column"
                  formatValue={(value) => formatCompactMoney(value, data.currency)}
                />
              ) : (
                <EmptyState
                  compact
                  title="No awarded spend"
                  description="Category splits appear once a purchase order is issued in this period."
                />
              )}
            </div>
          </Card>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Card className="overflow-hidden">
            <div className="border-b border-line bg-slate-50/50 px-5 py-3.5">
              <h2 className="flex items-center gap-1.5 text-[14px] font-bold text-ink">
                <Building2 size={15} className="text-brand-600" /> Top suppliers by awarded value
              </h2>
              <p className="text-[11px] text-muted">Issued purchase orders in {data.currency}</p>
            </div>
            {data.topVendors.length === 0 ? (
              <EmptyState
                compact
                icon={<Building2 size={20} />}
                title="No awarded suppliers"
                description="Suppliers appear here once an order is issued in the selected period."
              />
            ) : (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th className="text-right">Orders</th>
                      <th className="text-right">Spend</th>
                      <th className="w-28">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topVendors.map((vendor) => (
                      <tr key={vendor.id}>
                        <td>
                          <p className="font-bold text-ink">{vendor.name}</p>
                          <p className="text-[11px] text-muted">
                            {vendor.code ? <span className="font-mono mr-1">{vendor.code}</span> : null}
                            {vendor.category || "—"}
                          </p>
                        </td>
                        <td className="text-right font-semibold text-ink-soft">{vendor.orders}</td>
                        <td className="text-right font-bold text-ink">{formatMoney(vendor.total, vendor.currency)}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500"
                                style={{ width: `${Math.max(3, vendor.share)}%` }}
                              />
                            </div>
                            <span className="w-10 text-right text-[11px] font-bold text-muted">{vendor.share}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-line bg-slate-50/50 px-5 py-3.5">
              <h2 className="text-[14px] font-bold text-ink">Supplier performance</h2>
              <p className="text-[11px] text-muted">Invitations, quotations and award rate in this period</p>
            </div>
            {performance.loading && !performance.data ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2, 3].map((row) => (
                  <SkeletonBlock key={row} className="h-10" />
                ))}
              </div>
            ) : (performance.data?.rows.length ?? 0) === 0 ? (
              <EmptyState
                compact
                title="No supplier activity"
                description="Assign vendors to an RFQ or issue an order to populate this table."
              />
            ) : (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th className="hidden sm:table-cell text-right">Invited</th>
                      <th className="text-right">Quoted</th>
                      <th className="text-right">Awarded</th>
                      <th className="text-right">Win rate</th>
                      <th className="hidden md:table-cell text-right">Avg lead time</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.data?.rows.slice(0, 10).map((row) => (
                      <tr key={row.vendorId}>
                        <td>
                          <p className="font-bold text-ink">{row.name}</p>
                          <p className="text-[11px] text-muted">
                            <span className="font-mono mr-1">{row.code}</span>
                            {row.category}
                          </p>
                        </td>
                        <td className="hidden sm:table-cell text-right text-ink-soft">{row.invited}</td>
                        <td className="text-right text-ink-soft">{row.quoted}</td>
                        <td className="text-right font-semibold text-ink">{row.awarded}</td>
                        <td className="text-right font-semibold text-ink">
                          {row.winRate == null ? "—" : `${row.winRate}%`}
                        </td>
                        <td className="hidden md:table-cell text-right text-ink-soft">
                          {row.avgDeliveryDays == null ? "—" : `${row.avgDeliveryDays} days`}
                        </td>
                        <td>
                          <Badge status={row.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
