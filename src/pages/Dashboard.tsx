import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarDays,
  ClipboardList,
  FileSpreadsheet,
  IndianRupee,
  Layers,
  Plus,
  ShieldCheck,
  Star,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { DonutChart } from "../components/charts";
import { Page } from "../components/guards";
import { Badge, Card, EmptyState, ErrorState, PageHeader, SkeletonBlock, StatCard } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/format";
import type { Vendor } from "../lib/types";
import { useApi } from "../lib/useApi";

interface DashboardResponse {
  scope: "internal" | "vendor";
  statusCounts: Record<string, number>;
  categoryCounts: { name: string; count: number }[];
  totalVendors: number;
  recentVendors?: Vendor[];
  vendor?: Vendor | null;
  hasVendorProfile?: boolean;
}

const UPCOMING = [
  {
    week: "Week 2",
    title: "RFQs & quotations",
    description: "Raise requests, invite vendors and compare submitted quotations.",
    icon: ClipboardList,
  },
  {
    week: "Week 3",
    title: "Approvals, orders & invoices",
    description: "Approve awards, generate purchase orders and issue invoices.",
    icon: FileSpreadsheet,
  },
  {
    week: "Week 4",
    title: "Reports & audit trail",
    description: "Spend analytics, exportable reports and a full activity history.",
    icon: ShieldCheck,
  },
];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function UpcomingModules() {
  return (
    <Card>
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[13px] font-semibold text-ink">Scheduled for later weeks</h2>
        <p className="text-[11px] text-muted">These modules ship next; their data areas stay empty until then</p>
      </div>
      <ul className="divide-y divide-line">
        {UPCOMING.map((module) => {
          const Icon = module.icon;
          return (
            <li key={module.week} className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-card bg-surface-muted text-muted">
                <Icon size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[12px] font-semibold text-ink">{module.title}</p>
                  <span className="badge badge-pending text-[10px]">{module.week}</span>
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{module.description}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function CategoryList({ items, total }: { items: { name: string; count: number }[]; total: number }) {
  if (items.length === 0) {
    return <EmptyState compact title="No categories yet" description="Categories appear once vendors are added." />;
  }
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <ul className="space-y-2.5">
      {items.slice(0, 6).map((item) => (
        <li key={item.name}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="truncate text-[12px] text-ink-soft">{item.name}</span>
            <span className="shrink-0 text-[11px] text-muted">
              {item.count} · {Math.round((item.count / Math.max(total, 1)) * 100)}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-chip bg-neutral-soft">
            <div
              className="h-full bg-brand-600"
              style={{ width: `${Math.max(4, Math.round((item.count / max) * 100))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const { user, permissions, roleLabel } = useAuth();
  const { data, loading, error, refetch } = useApi<DashboardResponse>("/dashboard");

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  if (loading) {
    return (
      <div className="page-shell">
        <div className="mb-6 space-y-2">
          <SkeletonBlock className="h-3 w-32" />
          <SkeletonBlock className="h-7 w-72" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="card p-4">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="mt-3 h-7 w-20" />
              <SkeletonBlock className="mt-2 h-3 w-28" />
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <SkeletonBlock className="h-72 lg:col-span-2" />
          <SkeletonBlock className="h-72" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-shell">
        <PageHeader eyebrow="Overview" title="Dashboard" />
        <ErrorState message={error.message} onRetry={refetch} />
      </div>
    );
  }

  if (!data) return null;

  const isVendor = data.scope === "vendor";
  const activeVendors = data.statusCounts.Active ?? 0;
  const pendingVendors = data.statusCounts.Pending ?? 0;
  const statusSegments = ["Active", "Pending", "Inactive", "Blocked"]
    .map((status) => ({ label: status, value: data.statusCounts[status] ?? 0 }))
    .filter((segment) => segment.value > 0);

  return (
    <Page>
      <div className="page-shell">
        <PageHeader
          eyebrow={
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays size={12} aria-hidden />
              {today}
            </span>
          }
          title={`${greeting()}, ${user?.firstName ?? "there"}`}
          description={`${roleLabel} · Today's overview`}
          actions={
            isVendor ? (
              <Link to="/vendors" className="btn btn-ghost btn-sm">
                <Building2 size={13} />
                My vendor profile
              </Link>
            ) : (
              <>
                <Link to="/vendors" className="btn btn-ghost btn-sm">
                  <Building2 size={13} />
                  Vendor register
                </Link>
                {permissions?.manageVendors ? (
                  <Link to="/vendors?new=1" className="btn btn-primary btn-sm">
                    <Plus size={14} />
                    Add vendor
                  </Link>
                ) : null}
              </>
            )
          }
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Active RFQs"
            value="—"
            hint="Available in Week 2"
            icon={<ClipboardList size={15} />}
          />
          <StatCard
            label="Pending approvals"
            value="—"
            hint="Available in Week 3"
            icon={<BadgeCheck size={15} />}
          />
          <StatCard
            label="PO value"
            value="—"
            hint="Available in Week 3"
            icon={<IndianRupee size={15} />}
          />
          <StatCard
            label={isVendor ? "Suppliers on register" : "Active vendors"}
            value={isVendor ? data.totalVendors : activeVendors}
            hint={isVendor ? "Across all categories" : `${pendingVendors} awaiting verification`}
            icon={<Users size={15} />}
          />
        </div>

        {!isVendor ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {permissions?.manageVendors ? (
              <Link
                to="/vendors?new=1"
                className="card flex items-center gap-3 p-3 transition-colors hover:border-brand-300 hover:bg-brand-50"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-card bg-brand-50 text-brand-600">
                  <Plus size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-ink">Add a vendor</span>
                  <span className="block text-[11px] text-muted">Capture GST, contact and status</span>
                </span>
                <ArrowRight size={14} className="ml-auto text-muted" />
              </Link>
            ) : null}
            <Link
              to="/vendors"
              className="card flex items-center gap-3 p-3 transition-colors hover:border-brand-300 hover:bg-brand-50"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-card bg-brand-50 text-brand-600">
                <Building2 size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-ink">Manage vendors</span>
                <span className="block text-[11px] text-muted">Search, filter and update records</span>
              </span>
              <ArrowRight size={14} className="ml-auto text-muted" />
            </Link>
            <div className="card flex items-center gap-3 p-3 opacity-70">
              <span className="flex h-9 w-9 items-center justify-center rounded-card bg-surface-muted text-muted">
                <ClipboardList size={16} />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-[12px] font-semibold text-ink">
                  Create an RFQ
                  <span className="badge badge-pending text-[10px]">Week 2</span>
                </span>
                <span className="block text-[11px] text-muted">Invite vendors to quote</span>
              </span>
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-4 lg:col-span-2">
            {isVendor ? (
              data.vendor ? (
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-card bg-brand-50 text-[14px] font-bold text-brand-700">
                        {data.vendor.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <h2 className="text-[15px] font-semibold text-ink">{data.vendor.name}</h2>
                        <p className="text-[11px] text-muted">
                          {data.vendor.code} · {data.vendor.category}
                        </p>
                      </div>
                    </div>
                    <Badge status={data.vendor.status} />
                  </div>
                  <dl className="grid gap-4 px-4 py-4 sm:grid-cols-2">
                    <div>
                      <dt className="text-[10px] uppercase tracking-[0.06em] text-muted">Primary contact</dt>
                      <dd className="mt-1 text-[12px] font-medium text-ink">{data.vendor.contactName || "—"}</dd>
                      <dd className="mt-0.5 text-[11px] text-muted">{data.vendor.email}</dd>
                      <dd className="text-[11px] text-muted">{data.vendor.phone || "No phone on file"}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-[0.06em] text-muted">Location & compliance</dt>
                      <dd className="mt-1 text-[12px] text-ink">
                        {[data.vendor.city, data.vendor.country].filter(Boolean).join(", ") || "No address"}
                      </dd>
                      <dd className="mt-0.5 font-mono text-[11px] text-muted">{data.vendor.gstin || "GSTIN pending"}</dd>
                      <dd className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                        <Star size={11} /> {data.vendor.rating.toFixed(1)} rating
                      </dd>
                    </div>
                  </dl>
                  <div className="border-t border-line px-4 py-3">
                    <Link to="/vendors" className="link text-[11px]">
                      View full vendor profile
                    </Link>
                  </div>
                </Card>
              ) : (
                <Card>
                  <EmptyState
                    icon={<Building2 size={18} />}
                    title="Vendor profile missing"
                    description="Your account is not linked to a vendor record yet. Contact the procurement team to complete onboarding."
                  />
                </Card>
              )
            ) : (
              <Card>
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <div>
                    <h2 className="text-[13px] font-semibold text-ink">Vendor register</h2>
                    <p className="text-[11px] text-muted">Most recently updated supplier records</p>
                  </div>
                  <Link to="/vendors" className="link text-[11px]">
                    View all
                  </Link>
                </div>
                {data.recentVendors && data.recentVendors.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Vendor</th>
                          <th className="hidden sm:table-cell">Category</th>
                          <th className="hidden md:table-cell">Contact</th>
                          <th>Status</th>
                          <th className="hidden text-right lg:table-cell">Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentVendors.map((vendor) => (
                          <tr key={vendor.id}>
                            <td>
                              <Link to="/vendors" className="font-medium text-brand-700 hover:underline">
                                {vendor.name}
                              </Link>
                              <p className="text-[10px] text-muted">
                                {vendor.code} · {vendor.city || "—"}
                              </p>
                            </td>
                            <td className="hidden text-ink-soft sm:table-cell">{vendor.category}</td>
                            <td className="hidden max-w-[180px] md:table-cell">
                              <p className="truncate text-[12px] text-ink-soft">{vendor.contactName || "—"}</p>
                              <p className="truncate text-[10px] text-muted">{vendor.email}</p>
                            </td>
                            <td>
                              <Badge status={vendor.status} />
                            </td>
                            <td className="hidden text-right text-muted lg:table-cell">
                              {formatDate(vendor.updatedAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    icon={<Building2 size={18} />}
                    title="No vendors yet"
                    description="Add your first supplier to start building the vendor register."
                    action={
                      permissions?.manageVendors ? (
                        <Link to="/vendors?new=1" className="btn btn-primary btn-sm">
                          Add vendor
                        </Link>
                      ) : undefined
                    }
                  />
                )}
              </Card>
            )}

            <UpcomingModules />
          </div>

          <div className="min-w-0 space-y-4">
            <Card>
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-[13px] font-semibold text-ink">Vendor status</h2>
                <p className="text-[11px] text-muted">Onboarding health across the register</p>
              </div>
              <div className="px-4 py-4">
                {statusSegments.length > 0 ? (
                  <DonutChart segments={statusSegments} totalLabel="Vendors" totalValue={String(data.totalVendors)} />
                ) : (
                  <EmptyState compact title="No vendors yet" description="Status splits appear once records exist." />
                )}
              </div>
            </Card>

            <Card>
              <div className="border-b border-line px-4 py-3">
                <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  <Layers size={13} className="text-brand-600" />
                  Vendors by category
                </h2>
                <p className="text-[11px] text-muted">Top supplier categories on file</p>
              </div>
              <div className="px-4 py-4">
                <CategoryList items={data.categoryCounts} total={data.totalVendors} />
              </div>
            </Card>

            <Card className="p-4">
              <p className="text-[12px] font-semibold text-ink">Week 1 scope</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                Authentication, role-aware navigation, the dashboard foundation and full vendor management are live.
                Vendor figures are read directly from the database.
              </p>
              <Link to="/vendors" className="btn btn-ghost btn-sm mt-3 w-full">
                Open vendor register
              </Link>
            </Card>
          </div>
        </div>
      </div>
    </Page>
  );
}
