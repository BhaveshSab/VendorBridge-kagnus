import { motion, type Variants } from "framer-motion";
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
  Sparkles,
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
  rfqSummary: {
    open: number;
    total?: number;
    expired?: number;
    draft?: number;
    closed?: number;
    cancelled?: number;
    quotations?: number;
    assigned?: number;
    submitted?: number;
  };
}

const metricGridVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

const metricCardVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

const UPCOMING = [
  {
    badge: "Planned",
    title: "Approvals, orders & invoices",
    description: "Approve awards, generate purchase orders and issue invoices.",
    icon: FileSpreadsheet,
    badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  {
    badge: "Roadmap",
    title: "Reports & audit trail",
    description: "Spend analytics, exportable reports and a full activity history.",
    icon: ShieldCheck,
    badgeColor: "bg-amber-50 text-amber-700 border-amber-200",
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
    <Card className="overflow-hidden">
      <div className="border-b border-line/80 bg-slate-50/50 px-5 py-3.5">
        <h2 className="text-[13px] font-bold text-ink flex items-center gap-2">
          <Sparkles size={15} className="text-amber-500" />
          Scheduled for upcoming milestones
        </h2>
        <p className="text-[11px] text-muted">Planned enterprise capabilities on the product roadmap</p>
      </div>
      <ul className="divide-y divide-line/60">
        {UPCOMING.map((module) => {
          const Icon = module.icon;
          return (
            <li key={module.title} className="flex items-start gap-3.5 px-5 py-3.5 hover:bg-slate-50/40 transition-colors">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 border border-slate-200/60 shadow-xs">
                <Icon size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] font-bold text-ink">{module.title}</p>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${module.badgeColor}`}>
                    {module.badge}
                  </span>
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
    <ul className="space-y-3">
      {items.slice(0, 6).map((item) => {
        const percent = Math.round((item.count / Math.max(total, 1)) * 100);
        const barWidth = Math.max(6, Math.round((item.count / max) * 100));
        return (
          <li key={item.name} className="p-1.5 rounded-lg hover:bg-slate-50/80 transition-colors">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="truncate text-[12px] font-semibold text-ink-soft">{item.name}</span>
              <span className="shrink-0 text-[11px] font-bold text-slate-500">
                {item.count} <span className="font-normal text-muted">({percent}%)</span>
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 shadow-inner">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${barWidth}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="h-full bg-gradient-to-r from-violet-500 to-indigo-600 rounded-full"
              />
            </div>
          </li>
        );
      })}
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
          <SkeletonBlock className="h-8 w-72" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="card p-5">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="mt-3 h-8 w-20" />
              <SkeletonBlock className="mt-2 h-3 w-28" />
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
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
            <span className="inline-flex items-center gap-1.5 text-brand-600 font-bold">
              <CalendarDays size={13} aria-hidden />
              {today}
            </span>
          }
          title={`${greeting()}, ${user?.firstName ?? "there"}`}
          description={`${roleLabel} · Real-time procurement overview`}
          actions={
            isVendor ? (
              <>
                <Link to="/rfqs" className="btn btn-ghost btn-sm">
                  <ClipboardList size={14} />
                  My RFQs
                </Link>
                <Link to="/vendors" className="btn btn-ghost btn-sm">
                  <Building2 size={14} />
                  My vendor profile
                </Link>
              </>
            ) : (
              <>
                <Link to="/vendors" className="btn btn-ghost btn-sm">
                  <Building2 size={14} />
                  Vendor register
                </Link>
                {permissions?.manageVendors ? (
                  <Link to="/vendors?new=1" className="btn btn-primary btn-sm">
                    <Plus size={15} />
                    Add vendor
                  </Link>
                ) : null}
              </>
            )
          }
        />

        {/* Metric Cards */}
        <motion.div
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          variants={metricGridVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={metricCardVariants}>
            <StatCard
              label={isVendor ? "Open RFQs" : "Active RFQs"}
              value={data.rfqSummary?.open ?? 0}
              hint={
                isVendor
                  ? `${data.rfqSummary?.assigned ?? 0} assigned · ${data.rfqSummary?.submitted ?? 0} quoted`
                  : `${data.rfqSummary?.quotations ?? 0} quotations received`
              }
              icon={<ClipboardList size={18} />}
            />
          </motion.div>
          <motion.div variants={metricCardVariants}>
            <StatCard
              label="Pending approvals"
              value="—"
              hint="Scheduled release"
              icon={<BadgeCheck size={18} />}
            />
          </motion.div>
          <motion.div variants={metricCardVariants}>
            <StatCard
              label="PO value"
              value="—"
              hint="Scheduled release"
              icon={<IndianRupee size={18} />}
            />
          </motion.div>
          <motion.div variants={metricCardVariants}>
            <StatCard
              label={isVendor ? "My supplier profile" : "Total suppliers"}
              value={data.totalVendors}
              hint={
                isVendor
                  ? data.hasVendorProfile
                    ? "Linked to your account"
                    : "No linked profile"
                  : `${activeVendors} active · ${pendingVendors} pending`
              }
              icon={<Users size={18} />}
            />
          </motion.div>
        </motion.div>

        {/* Quick Action Tiles */}
        {!isVendor ? (
          <div className="mt-4 grid gap-3.5 sm:grid-cols-3">
            {permissions?.manageVendors ? (
              <Link
                to="/vendors?new=1"
                className="card card-hover flex items-center gap-3.5 p-4 transition-all hover:border-blue-400 group"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/10 to-indigo-500/20 text-brand-600 border border-blue-200/80 group-hover:scale-105 transition-transform">
                  <Plus size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold text-ink group-hover:text-brand-600 transition-colors">Add a new vendor</span>
                  <span className="block text-[11px] text-muted">Capture GSTIN, contacts &amp; status</span>
                </span>
                <ArrowRight size={15} className="ml-auto text-slate-400 group-hover:text-brand-600 group-hover:translate-x-1 transition-all" />
              </Link>
            ) : null}
            <Link
              to="/vendors"
              className="card card-hover flex items-center gap-3.5 p-4 transition-all hover:border-blue-400 group"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/10 to-indigo-500/20 text-brand-600 border border-blue-200/80 group-hover:scale-105 transition-transform">
                <Building2 size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-ink group-hover:text-brand-600 transition-colors">Manage vendors</span>
                <span className="block text-[11px] text-muted">Search, filter and update records</span>
              </span>
              <ArrowRight size={15} className="ml-auto text-slate-400 group-hover:text-brand-600 group-hover:translate-x-1 transition-all" />
            </Link>
            {permissions?.manageRfqs ? (
              <Link
                to="/rfqs/new"
                className="card card-hover flex items-center gap-3.5 p-4 transition-all hover:border-blue-400 group"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/10 to-indigo-500/20 text-brand-600 border border-blue-200/80 group-hover:scale-105 transition-transform">
                  <ClipboardList size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold text-ink group-hover:text-brand-600 transition-colors">
                    Create an RFQ
                  </span>
                  <span className="block text-[11px] text-muted">Invite suppliers to submit quotations</span>
                </span>
                <ArrowRight size={15} className="ml-auto text-slate-400 group-hover:text-brand-600 group-hover:translate-x-1 transition-all" />
              </Link>
            ) : (
              <Link
                to="/rfqs"
                className="card card-hover flex items-center gap-3.5 p-4 transition-all hover:border-blue-400 group"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/10 to-indigo-500/20 text-brand-600 border border-blue-200/80 group-hover:scale-105 transition-transform">
                  <ClipboardList size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold text-ink group-hover:text-brand-600 transition-colors">
                    Review RFQs
                  </span>
                  <span className="block text-[11px] text-muted">Supplier requests for quotation</span>
                </span>
                <ArrowRight size={15} className="ml-auto text-slate-400 group-hover:text-brand-600 group-hover:translate-x-1 transition-all" />
              </Link>
            )}
          </div>
        ) : null}

        {/* Main Content Grid */}
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <div className="min-w-0 space-y-5 lg:col-span-2">
            {isVendor ? (
              data.vendor ? (
                <Card className="overflow-hidden card-hover">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-gradient-to-r from-blue-50/40 to-white px-5 py-4">
                    <div className="flex items-start gap-3.5">
                      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 text-[15px] font-bold text-white shadow-xs">
                        {data.vendor.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <h2 className="text-[16px] font-bold text-ink">{data.vendor.name}</h2>
                        <p className="text-[12px] text-muted">
                          <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[11px] font-semibold text-slate-700 mr-1.5">{data.vendor.code}</span>
                          {data.vendor.category}
                        </p>
                      </div>
                    </div>
                    <Badge status={data.vendor.status} />
                  </div>
                  <dl className="grid gap-4 px-5 py-5 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200/80 p-3.5 bg-slate-50/40">
                      <dt className="text-[10px] font-bold uppercase tracking-[0.07em] text-muted">Primary contact</dt>
                      <dd className="mt-1 text-[13px] font-bold text-ink">{data.vendor.contactName || "—"}</dd>
                      <dd className="mt-0.5 text-[12px] text-muted">{data.vendor.email}</dd>
                      <dd className="text-[12px] text-muted">{data.vendor.phone || "No phone on file"}</dd>
                    </div>
                    <div className="rounded-xl border border-slate-200/80 p-3.5 bg-slate-50/40">
                      <dt className="text-[10px] font-bold uppercase tracking-[0.07em] text-muted">Location & compliance</dt>
                      <dd className="mt-1 text-[13px] font-semibold text-ink">
                        {[data.vendor.city, data.vendor.country].filter(Boolean).join(", ") || "No address"}
                      </dd>
                      <dd className="mt-0.5 font-mono text-[11px] text-slate-600">{data.vendor.gstin || "GSTIN pending"}</dd>
                      <dd className="mt-1 flex items-center gap-1 text-[12px] font-bold text-amber-600">
                        <Star size={12} className="fill-amber-400 text-amber-500" /> {data.vendor.rating.toFixed(1)} rating
                      </dd>
                    </div>
                  </dl>
                  <div className="border-t border-line bg-slate-50/50 px-5 py-3">
                    <Link to="/vendors" className="link text-[12px] font-bold inline-flex items-center gap-1">
                      View full vendor profile <ArrowRight size={13} />
                    </Link>
                  </div>
                </Card>
              ) : (
                <Card>
                  <EmptyState
                    icon={<Building2 size={20} />}
                    title="Vendor profile missing"
                    description="Your account is not linked to a vendor record yet. Contact the procurement team to complete onboarding."
                  />
                </Card>
              )
            ) : (
              <Card className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-line bg-slate-50/50 px-5 py-3.5">
                  <div>
                    <h2 className="text-[14px] font-bold text-ink">Vendor register snapshot</h2>
                    <p className="text-[11px] text-muted">Most recently updated supplier records</p>
                  </div>
                  <Link to="/vendors" className="link text-[12px] font-bold inline-flex items-center gap-1">
                    View all <ArrowRight size={13} />
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
                              <Link to="/vendors" className="font-bold text-brand-600 hover:text-brand-700 hover:underline">
                                {vendor.name}
                              </Link>
                              <p className="text-[11px] text-muted">
                                <span className="font-mono bg-slate-100 text-slate-700 px-1 py-0.2 rounded text-[10px] font-semibold mr-1">{vendor.code}</span>
                                {vendor.city || "—"}
                              </p>
                            </td>
                            <td className="hidden text-ink-soft sm:table-cell">
                              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                {vendor.category}
                              </span>
                            </td>
                            <td className="hidden max-w-[180px] md:table-cell">
                              <p className="truncate text-[12px] font-semibold text-ink-soft">{vendor.contactName || "—"}</p>
                              <p className="truncate text-[11px] text-muted">{vendor.email}</p>
                            </td>
                            <td>
                              <Badge status={vendor.status} />
                            </td>
                            <td className="hidden text-right text-[11px] text-muted lg:table-cell font-medium">
                              {formatDate(vendor.updatedAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    icon={<Building2 size={20} />}
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

          <div className="min-w-0 space-y-5">
            <Card className="overflow-hidden">
              <div className="border-b border-line bg-slate-50/50 px-5 py-3.5">
                <h2 className="text-[13px] font-bold text-ink">Vendor status breakdown</h2>
                <p className="text-[11px] text-muted">
                  {isVendor ? "Your supplier profile status" : "Onboarding health across the register"}
                </p>
              </div>
              <div className="px-5 py-5">
                {statusSegments.length > 0 ? (
                  <DonutChart segments={statusSegments} totalLabel="Total" totalValue={String(data.totalVendors)} />
                ) : (
                  <EmptyState compact title="No vendors yet" description="Status splits appear once records exist." />
                )}
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-line bg-slate-50/50 px-5 py-3.5">
                <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
                  <Layers size={15} className="text-brand-600" />
                  Vendors by category
                </h2>
                <p className="text-[11px] text-muted">Top supplier categories on file</p>
              </div>
              <div className="px-5 py-4">
                <CategoryList items={data.categoryCounts} total={data.totalVendors} />
              </div>
            </Card>

            <Card className="p-5 border-blue-100 bg-gradient-to-br from-white to-blue-50/30">
              <p className="text-[13px] font-bold text-ink">Procurement workspace</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                Vendor management, RFQ publishing and quotation comparison are live. Approvals and purchase orders remain
                scheduled for the next milestone.
              </p>
              <div className="mt-3.5 flex flex-col gap-2">
                <Link to="/vendors" className="btn btn-ghost btn-sm w-full justify-center">
                  Open vendor register
                </Link>
                <Link to="/rfqs" className="btn btn-ghost btn-sm w-full justify-center">
                  Open RFQs &amp; quotations
                </Link>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </Page>
  );
}
