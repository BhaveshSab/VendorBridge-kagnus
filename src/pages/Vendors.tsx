import {
  Building2,
  Check,
  Eye,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Star,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Page } from "../components/guards";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  SkeletonBlock,
  StatCard,
} from "../components/ui";
import { VendorFormModal } from "../components/VendorFormModal";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import type { Vendor } from "../lib/types";
import { useApi, useApiMutation } from "../lib/useApi";
import { useDebounced } from "../lib/useDebounced";

interface VendorListResponse {
  items: Vendor[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts?: Record<string, number>;
}

interface VendorMeta {
  categories: { name: string; count: number }[];
  statuses: string[];
  total: number;
}

interface VendorDetail {
  vendor: Vendor;
}

const PAGE_SIZE = 8;

export default function Vendors() {
  const { user, permissions } = useAuth();
  const toast = useToast();
  const isVendor = user?.role === "vendor";
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("updated");
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Vendor | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const meta = useApi<VendorMeta>("/vendors/meta");
  const list = useApi<VendorListResponse>(isVendor ? "/vendors" : "/vendors", {
    search: debouncedSearch,
    status,
    category,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });
  const detail = useApi<VendorDetail>(!isVendor && detailId ? `/vendors/${detailId}` : null);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, category, sort]);

  useEffect(() => {
    if (isVendor || !permissions?.manageVendors || searchParams.get("new") !== "1") return;
    setEditing(null);
    setFormOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  }, [isVendor, permissions?.manageVendors, searchParams, setSearchParams]);

  const categories = meta.data?.categories.map((item) => item.name) ?? [];
  const counts = list.data?.statusCounts;
  const canManage = Boolean(permissions?.manageVendors);

  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      window.setTimeout(() => setCopiedField(null), 1500);
    } catch {}
  };

  const deleteVendor = useApiMutation((target: Vendor) => api.del(`/vendors/${target.id}`), {
    invalidate: ["/vendors"],
  });

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await deleteVendor.mutateAsync(deleting);
      toast.success("Vendor deleted", `${deleting.name} was removed from the register.`);
      setDeleting(null);
    } catch (error) {
      toast.error("Unable to delete vendor", errorMessage(error));
      setDeleting(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  const hasFilters = Boolean(debouncedSearch) || status !== "all" || category !== "all" || sort !== "updated";
  const vendorProfile = isVendor ? list.data?.items[0] : null;

  return (
    <Page>
      <div className="page-shell">
        <PageHeader
          eyebrow="Supplier register"
          title={isVendor ? "My vendor profile" : "Vendor Directory"}
          description={
            isVendor
              ? "The procurement team maintains your supplier record. Review your status and commercial details here."
              : "Manage supplier profiles, compliance details, GSTIN records, and onboarding status."
          }
          actions={
            canManage && !isVendor ? (
              <Button
                size="sm"
                icon={<Plus size={15} />}
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                Add new vendor
              </Button>
            ) : null
          }
        />

        {isVendor ? (
          list.loading ? (
            <SkeletonBlock className="h-56" />
          ) : vendorProfile ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                  label="Account status"
                  value={<Badge status={vendorProfile.status} />}
                  hint="Maintained by procurement team"
                  icon={<Building2 size={18} />}
                />
                <StatCard
                  label="Supplier rating"
                  value={
                    <span className="flex items-center gap-1.5">
                      <Star size={20} className="fill-amber-400 text-amber-500" />
                      {vendorProfile.rating.toFixed(1)}
                    </span>
                  }
                  hint="Overall performance rating (0–5)"
                  icon={<Star size={18} />}
                />
                <StatCard
                  label="Registration"
                  value={vendorProfile.code}
                  hint={`Added ${formatDate(vendorProfile.createdAt)}`}
                  icon={<Building2 size={18} />}
                />
              </div>

              <Card className="mt-5 overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line bg-gradient-to-r from-blue-50/40 to-white px-6 py-5">
                  <div className="flex items-start gap-4">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-brand-600 to-indigo-600 text-[16px] font-bold text-white shadow-xs">
                      {vendorProfile.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <h2 className="text-[18px] font-bold text-ink">{vendorProfile.name}</h2>
                      <p className="text-[12px] text-muted">
                        <span className="font-mono bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[11px] font-semibold mr-1.5">{vendorProfile.code}</span>
                        {vendorProfile.category}
                      </p>
                    </div>
                  </div>
                  <Badge status={vendorProfile.status} />
                </div>
                <dl className="grid gap-5 px-6 py-6 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-xl border border-slate-200/80 p-4 bg-slate-50/30">
                    <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Primary contact</dt>
                    <dd className="mt-1 text-[13px] font-bold text-ink">{vendorProfile.contactName || "—"}</dd>
                    <dd className="mt-1 flex items-center gap-1.5 text-[12px] text-muted">
                      <Mail size={13} className="text-slate-400" /> {vendorProfile.email}
                    </dd>
                    <dd className="flex items-center gap-1.5 text-[12px] text-muted">
                      <Phone size={13} className="text-slate-400" /> {vendorProfile.phone || "—"}
                    </dd>
                  </div>
                  <div className="rounded-xl border border-slate-200/80 p-4 bg-slate-50/30">
                    <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Address & location</dt>
                    <dd className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                      <MapPin size={13} className="text-slate-400" /> {[vendorProfile.city, vendorProfile.country].filter(Boolean).join(", ") || "—"}
                    </dd>
                    <dd className="mt-1 text-[12px] text-muted">{vendorProfile.address || "No street address on file"}</dd>
                  </div>
                  <div className="rounded-xl border border-slate-200/80 p-4 bg-slate-50/30">
                    <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Tax & commercial</dt>
                    <dd className="mt-1 font-mono text-[12px] font-bold text-ink">{vendorProfile.gstin || "GSTIN pending"}</dd>
                    <dd className="mt-1 flex items-center gap-1 text-[12px] font-bold text-amber-600">
                      <Star size={13} className="fill-amber-400 text-amber-500" /> {vendorProfile.rating.toFixed(1)} supplier rating
                    </dd>
                  </div>
                </dl>
                {vendorProfile.notes ? (
                  <div className="border-t border-line bg-slate-50/50 px-6 py-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Procurement notes</p>
                    <p className="mt-1 text-[13px] text-ink-soft leading-relaxed">{vendorProfile.notes}</p>
                  </div>
                ) : null}
              </Card>
            </>
          ) : (
            <Card>
              <EmptyState
                icon={<Building2 size={22} />}
                title="No vendor profile linked"
                description="Your account was created without a vendor record. Contact the procurement team to complete onboarding."
              />
            </Card>
          )
        ) : (
          <>
            {/* Top Metric Cards */}
            <div className="mb-4 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
              <StatCard label="Total vendors" value={list.data?.total ?? meta.data?.total ?? 0} hint="Registered suppliers" icon={<Building2 size={16} />} />
              <StatCard label="Active" value={counts?.Active ?? 0} hint="Approved for procurement" icon={<Check size={16} />} trend={{ value: `${counts?.Active ?? 0} live`, positive: true }} />
              <StatCard label="Pending" value={counts?.Pending ?? 0} hint="Awaiting review" icon={<Building2 size={16} />} />
              <StatCard label="Blocked / Inactive" value={(counts?.Blocked ?? 0) + (counts?.Inactive ?? 0)} hint="Restricted records" icon={<Building2 size={16} />} />
            </div>

            {/* Vendor Table Card */}
            <Card className="overflow-hidden">
              {/* Filter and Search Toolbar */}
              <div className="flex flex-col gap-3 border-b border-line bg-slate-50/40 p-4 lg:flex-row lg:items-center">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Search name, code, contact, city…"
                  className="lg:w-80"
                />
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:ml-auto">
                  <Select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                    aria-label="Filter by status"
                    className="input-sm font-medium"
                  >
                    <option value="all">All statuses</option>
                    {["Active", "Pending", "Inactive", "Blocked"].map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    aria-label="Filter by category"
                    className="input-sm font-medium"
                  >
                    <option value="all">All categories</option>
                    {categories.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={sort}
                    onChange={(event) => setSort(event.target.value)}
                    aria-label="Sort vendors"
                    className="input-sm font-medium"
                  >
                    <option value="updated">Recently updated</option>
                    <option value="name">Name A–Z</option>
                    <option value="rating">Highest rated</option>
                    <option value="created">Newest first</option>
                    <option value="status">Status</option>
                  </Select>
                </div>
                {hasFilters ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setStatus("all");
                      setCategory("all");
                      setSort("updated");
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 hover:text-brand-700 px-2 py-1 rounded-md hover:bg-blue-50 transition-colors"
                  >
                    <RotateCcw size={12} /> Reset
                  </button>
                ) : null}
              </div>

              {list.loading ? (
                <div className="space-y-3 p-5">
                  {[0, 1, 2, 3, 4].map((item) => (
                    <SkeletonBlock key={item} className="h-14 rounded-xl" />
                  ))}
                </div>
              ) : list.error ? (
                <ErrorState message={list.error.message} onRetry={list.refetch} />
              ) : list.data && list.data.items.length === 0 ? (
                <EmptyState
                  icon={<Building2 size={20} />}
                  title={hasFilters ? "No suppliers match those filters" : "No vendors yet"}
                  description={
                    hasFilters
                      ? "Try adjusting your search query, status or category selection."
                      : "Add your first supplier to start building the vendor register."
                  }
                  action={
                    hasFilters ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSearch("");
                          setStatus("all");
                          setCategory("all");
                          setSort("updated");
                        }}
                      >
                        Clear filters
                      </Button>
                    ) : canManage ? (
                      <Button
                        size="sm"
                        icon={<Plus size={14} />}
                        onClick={() => {
                          setEditing(null);
                          setFormOpen(true);
                        }}
                      >
                        Add vendor
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <>
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Vendor / Company</th>
                          <th>Category</th>
                          <th className="hidden md:table-cell">Contact Person</th>
                          <th className="hidden xl:table-cell">GSTIN</th>
                          <th>Status</th>
                          <th className="hidden sm:table-cell">Rating</th>
                          <th className="text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.data?.items.map((vendor) => (
                          <tr
                            key={vendor.id}
                            className="cursor-pointer group"
                            onClick={() => setDetailId(vendor.id)}
                          >
                            <td>
                              <div className="flex items-center gap-3">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-brand-50 to-indigo-50 border border-brand-200/60 text-[12px] font-bold text-brand-700 shadow-xs">
                                  {vendor.name.slice(0, 2).toUpperCase()}
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate font-bold text-ink group-hover:text-brand-600 transition-colors">{vendor.name}</p>
                                  <p className="text-[11px] text-muted flex items-center gap-1.5 mt-0.5">
                                    <span className="font-mono bg-slate-100 text-slate-700 px-1 py-0.2 rounded text-[10px] font-semibold">{vendor.code}</span>
                                    <span>{vendor.city || "—"}</span>
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                {vendor.category}
                              </span>
                            </td>
                            <td className="hidden md:table-cell">
                              <p className="text-[12px] font-bold text-ink-soft">{vendor.contactName || "—"}</p>
                              <p className="text-[11px] text-muted">{vendor.email}</p>
                            </td>
                            <td className="hidden font-mono text-[11px] text-slate-600 xl:table-cell font-medium">
                              {vendor.gstin || "—"}
                            </td>
                            <td>
                              <Badge status={vendor.status} />
                            </td>
                            <td className="hidden text-[12px] sm:table-cell">
                              <span className="inline-flex items-center gap-1 font-bold text-amber-600">
                                <Star size={12} className="fill-amber-400 text-amber-500" />
                                {vendor.rating > 0 ? vendor.rating.toFixed(1) : "—"}
                              </span>
                            </td>
                            <td>
                              <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                                <IconButton label={`View ${vendor.name}`} onClick={() => setDetailId(vendor.id)}>
                                  <Eye size={15} />
                                </IconButton>
                                {canManage ? (
                                  <>
                                    <IconButton
                                      label={`Edit ${vendor.name}`}
                                      onClick={() => {
                                        setEditing(vendor);
                                        setFormOpen(true);
                                      }}
                                    >
                                      <Pencil size={15} />
                                    </IconButton>
                                    <IconButton
                                      label={`Delete ${vendor.name}`}
                                      onClick={() => setDeleting(vendor)}
                                      className="hover:bg-rose-50 hover:text-rose-600"
                                    >
                                      <Trash2 size={15} />
                                    </IconButton>
                                  </>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    page={list.data?.page ?? 1}
                    pageSize={PAGE_SIZE}
                    total={list.data?.total ?? 0}
                    onPageChange={setPage}
                  />
                </>
              )}
            </Card>
          </>
        )}
      </div>

      <VendorFormModal
        open={formOpen}
        vendor={editing}
        categories={categories}
        onClose={() => setFormOpen(false)}
      />

      {/* Vendor Detail Modal */}
      <Modal
        open={detailId != null}
        onClose={() => setDetailId(null)}
        size="lg"
        title={detail.data?.vendor.name ?? "Vendor details"}
        description={detail.data ? `${detail.data.vendor.code} · ${detail.data.vendor.category}` : undefined}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDetailId(null)}>
              Close
            </Button>
            {canManage && detail.data ? (
              <Button
                size="sm"
                icon={<Pencil size={13} />}
                onClick={() => {
                  setEditing(detail.data?.vendor ?? null);
                  setDetailId(null);
                  setFormOpen(true);
                }}
              >
                Edit vendor
              </Button>
            ) : null}
          </>
        }
      >
        {detail.loading ? (
          <div className="space-y-3">
            <SkeletonBlock className="h-16 rounded-xl" />
            <SkeletonBlock className="h-28 rounded-xl" />
          </div>
        ) : detail.error ? (
          <ErrorState message={detail.error.message} onRetry={detail.refetch} />
        ) : detail.data ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-100">
              <div className="flex flex-wrap items-center gap-2.5">
                <Badge status={detail.data.vendor.status} />
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700 border border-amber-200">
                  <Star size={12} className="fill-amber-400 text-amber-500" /> {detail.data.vendor.rating.toFixed(1)} rating
                </span>
                <span className="font-mono bg-white px-2 py-0.5 rounded text-[11px] font-bold text-slate-700 border border-slate-200">
                  {detail.data.vendor.code}
                </span>
              </div>
              <span className="text-[11px] font-medium text-muted">
                Added {formatDate(detail.data.vendor.createdAt)}
              </span>
            </div>

            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200/80 p-4 bg-slate-50/40">
                <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Primary contact</dt>
                <dd className="mt-1 text-[13px] font-bold text-ink">{detail.data.vendor.contactName || "—"}</dd>
                <dd className="mt-1 flex items-center justify-between gap-1 text-[12px] text-muted">
                  <span className="flex items-center gap-1.5 truncate">
                    <Mail size={13} className="text-slate-400 shrink-0" /> {detail.data.vendor.email}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(detail.data?.vendor.email ?? "", "email")}
                    className="text-[11px] font-bold text-brand-600 hover:text-brand-700"
                  >
                    {copiedField === "email" ? "Copied" : "Copy"}
                  </button>
                </dd>
                <dd className="flex items-center gap-1.5 text-[12px] text-muted mt-0.5">
                  <Phone size={13} className="text-slate-400 shrink-0" /> {detail.data.vendor.phone || "—"}
                </dd>
              </div>

              <div className="rounded-xl border border-slate-200/80 p-4 bg-slate-50/40">
                <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Tax &amp; Location</dt>
                <dd className="mt-1 flex items-center justify-between font-mono text-[12px] font-bold text-ink">
                  <span>{detail.data.vendor.gstin || "GSTIN not provided"}</span>
                  {detail.data.vendor.gstin ? (
                    <button
                      type="button"
                      onClick={() => copyToClipboard(detail.data?.vendor.gstin ?? "", "gstin")}
                      className="font-sans text-[11px] font-bold text-brand-600 hover:text-brand-700"
                    >
                      {copiedField === "gstin" ? "Copied" : "Copy"}
                    </button>
                  ) : null}
                </dd>
                <dd className="mt-1 flex items-start gap-1.5 text-[12px] text-muted">
                  <MapPin size={13} className="mt-0.5 shrink-0 text-slate-400" />
                  <span>
                    {detail.data.vendor.address || "No address"}
                    {detail.data.vendor.city ? `, ${detail.data.vendor.city}` : ""}
                    {detail.data.vendor.country ? `, ${detail.data.vendor.country}` : ""}
                  </span>
                </dd>
              </div>
            </dl>

            {detail.data.vendor.notes ? (
              <div className="rounded-xl border border-slate-200/80 p-4 bg-slate-50/40">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Internal notes</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{detail.data.vendor.notes}</p>
              </div>
            ) : null}

            <div className="rounded-xl bg-slate-100/70 p-3.5 text-[11px] text-slate-600 flex items-center justify-between">
              <span>Code: <span className="font-mono font-bold text-slate-800">{detail.data.vendor.code}</span></span>
              <span>Last updated: <span className="font-medium text-slate-800">{formatDate(detail.data.vendor.updatedAt)}</span></span>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        loading={deleteLoading}
        title={`Delete ${deleting?.name ?? "vendor"}?`}
        message="This permanently removes the vendor from the register. Set the status to Inactive instead if you want to keep the record."
        confirmLabel="Delete vendor"
      />
    </Page>
  );
}
