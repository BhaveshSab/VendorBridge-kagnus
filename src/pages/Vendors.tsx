import {
  Building2,
  Eye,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
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
import { useApi } from "../lib/useApi";
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

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await api.del(`/vendors/${deleting.id}`);
      toast.success("Vendor deleted", `${deleting.name} was removed from the register.`);
      setDeleting(null);
      list.refetch();
      meta.refetch();
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
          eyebrow="Vendor management"
          title={isVendor ? "My vendor profile" : "Vendors"}
          description={
            isVendor
              ? "The procurement team maintains your supplier record. Review your status and commercial details here."
              : "Manage supplier profiles, compliance details, and onboarding status."
          }
          actions={
            canManage && !isVendor ? (
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
            ) : null
          }
        />

        {isVendor ? (
          list.loading ? (
            <SkeletonBlock className="h-48" />
          ) : vendorProfile ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard
                  label="Account status"
                  value={<Badge status={vendorProfile.status} />}
                  hint="Maintained by procurement"
                  icon={<Building2 size={15} />}
                />
                <StatCard
                  label="Supplier rating"
                  value={vendorProfile.rating.toFixed(1)}
                  hint="Out of 5.0"
                  icon={<Star size={15} />}
                />
                <StatCard
                  label="On the register since"
                  value={formatDate(vendorProfile.createdAt)}
                  hint={vendorProfile.code}
                  icon={<Building2 size={15} />}
                />
              </div>
              <Card className="mt-4">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-card bg-brand-50 text-[14px] font-bold text-brand-700">
                      {vendorProfile.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <h2 className="text-[15px] font-semibold text-ink">{vendorProfile.name}</h2>
                      <p className="text-[11px] text-muted">
                        {vendorProfile.code} · {vendorProfile.category}
                      </p>
                    </div>
                  </div>
                  <Badge status={vendorProfile.status} />
                </div>
                <dl className="grid gap-4 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <dt className="text-[10px] uppercase tracking-[0.06em] text-muted">Contact</dt>
                    <dd className="mt-1 text-[12px] font-medium text-ink">{vendorProfile.contactName || "—"}</dd>
                    <dd className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                      <Mail size={11} /> {vendorProfile.email}
                    </dd>
                    <dd className="flex items-center gap-1 text-[11px] text-muted">
                      <Phone size={11} /> {vendorProfile.phone || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-[0.06em] text-muted">Location</dt>
                    <dd className="mt-1 flex items-center gap-1 text-[12px] text-ink">
                      <MapPin size={11} /> {[vendorProfile.city, vendorProfile.country].filter(Boolean).join(", ") || "—"}
                    </dd>
                    <dd className="mt-0.5 text-[11px] text-muted">{vendorProfile.address || "No address on file"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-[0.06em] text-muted">Compliance</dt>
                    <dd className="mt-1 font-mono text-[12px] text-ink">{vendorProfile.gstin || "GSTIN pending"}</dd>
                    <dd className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                      <Star size={11} /> {vendorProfile.rating.toFixed(1)} supplier rating
                    </dd>
                  </div>
                </dl>
                {vendorProfile.notes ? (
                  <div className="border-t border-line px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.06em] text-muted">Procurement notes</p>
                    <p className="mt-1 text-[12px] text-ink-soft">{vendorProfile.notes}</p>
                  </div>
                ) : null}
              </Card>
            </>
          ) : (
            <Card>
              <EmptyState
                icon={<Building2 size={18} />}
                title="No vendor profile linked"
                description="Your account was created without a vendor record. Contact the procurement team to complete onboarding."
              />
            </Card>
          )
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Total vendors" value={list.data?.total ?? meta.data?.total ?? 0} hint="In the register" />
              <StatCard label="Active" value={counts?.Active ?? 0} hint="Approved suppliers" />
              <StatCard label="Pending" value={counts?.Pending ?? 0} hint="Awaiting verification" />
              <StatCard label="Blocked" value={(counts?.Blocked ?? 0) + (counts?.Inactive ?? 0)} hint="Inactive or blocked" />
            </div>

            <Card>
              <div className="flex flex-col gap-2 border-b border-line p-3 lg:flex-row lg:items-center">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Search vendors, contact, city…"
                  className="lg:w-72"
                />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:ml-auto">
                  <Select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                    aria-label="Filter by status"
                    className="input-sm"
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
                    className="input-sm"
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
                    className="input-sm"
                  >
                    <option value="updated">Recently updated</option>
                    <option value="name">Name A–Z</option>
                    <option value="rating">Highest rated</option>
                    <option value="created">Newest first</option>
                    <option value="status">Status</option>
                  </Select>
                </div>
              </div>

              {list.loading ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2, 3, 4].map((item) => (
                    <SkeletonBlock key={item} className="h-12" />
                  ))}
                </div>
              ) : list.error ? (
                <ErrorState message={list.error.message} onRetry={list.refetch} />
              ) : list.data && list.data.items.length === 0 ? (
                <EmptyState
                  icon={<Building2 size={18} />}
                  title={hasFilters ? "No vendors match those filters" : "No vendors yet"}
                  description={
                    hasFilters
                      ? "Try a different search term or clear the filters."
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
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Vendor</th>
                          <th>Category</th>
                          <th className="hidden md:table-cell">Contact</th>
                          <th className="hidden xl:table-cell">GSTIN</th>
                          <th>Status</th>
                          <th className="hidden sm:table-cell">Updated</th>
                          <th className="text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.data?.items.map((vendor) => (
                          <tr
                            key={vendor.id}
                            className="cursor-pointer"
                            onClick={() => setDetailId(vendor.id)}
                          >
                            <td>
                              <div className="flex items-center gap-2">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card bg-brand-50 text-[11px] font-bold text-brand-700">
                                  {vendor.name.slice(0, 2).toUpperCase()}
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-ink">{vendor.name}</p>
                                  <p className="text-[10px] text-muted">
                                    {vendor.code} · {vendor.city || "—"}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="text-ink-soft">{vendor.category}</td>
                            <td className="hidden md:table-cell">
                              <p className="text-[12px] text-ink-soft">{vendor.contactName || "—"}</p>
                              <p className="text-[10px] text-muted">{vendor.email}</p>
                            </td>
                            <td className="hidden font-mono text-[11px] text-muted xl:table-cell">
                              {vendor.gstin || "—"}
                            </td>
                            <td>
                              <Badge status={vendor.status} />
                            </td>
                            <td className="hidden text-[11px] text-muted sm:table-cell">
                              {formatDate(vendor.updatedAt)}
                            </td>
                            <td>
                              <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                                <IconButton label={`View ${vendor.name}`} onClick={() => setDetailId(vendor.id)}>
                                  <Eye size={14} />
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
                                      <Pencil size={14} />
                                    </IconButton>
                                    <IconButton
                                      label={`Delete ${vendor.name}`}
                                      onClick={() => setDeleting(vendor)}
                                      className="hover:bg-danger-soft hover:text-danger"
                                    >
                                      <Trash2 size={14} />
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
        onSaved={() => {
          list.refetch();
          meta.refetch();
        }}
      />

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
          <div className="space-y-2">
            <SkeletonBlock className="h-16" />
            <SkeletonBlock className="h-24" />
          </div>
        ) : detail.error ? (
          <ErrorState message={detail.error.message} onRetry={detail.refetch} />
        ) : detail.data ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge status={detail.data.vendor.status} />
                <span className="badge badge-pending">
                  <Star size={10} /> {detail.data.vendor.rating.toFixed(1)}
                </span>
              </div>
              <span className="text-[11px] text-muted">
                Vendor since {formatDate(detail.data.vendor.createdAt)}
              </span>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-card border border-line p-3">
                <dt className="text-[10px] uppercase tracking-[0.06em] text-muted">Primary contact</dt>
                <dd className="mt-1 text-[12px] font-medium text-ink">{detail.data.vendor.contactName || "—"}</dd>
                <dd className="mt-1 flex items-center gap-1 text-[11px] text-muted">
                  <Mail size={11} /> {detail.data.vendor.email}
                </dd>
                <dd className="flex items-center gap-1 text-[11px] text-muted">
                  <Phone size={11} /> {detail.data.vendor.phone || "—"}
                </dd>
              </div>
              <div className="rounded-card border border-line p-3">
                <dt className="text-[10px] uppercase tracking-[0.06em] text-muted">Billing details</dt>
                <dd className="mt-1 font-mono text-[11px] text-ink">{detail.data.vendor.gstin || "GSTIN not provided"}</dd>
                <dd className="mt-1 flex items-start gap-1 text-[11px] text-muted">
                  <MapPin size={11} className="mt-0.5 shrink-0" />
                  <span>
                    {detail.data.vendor.address || "No address"}
                    {detail.data.vendor.city ? `, ${detail.data.vendor.city}` : ""}
                    {detail.data.vendor.country ? `, ${detail.data.vendor.country}` : ""}
                  </span>
                </dd>
              </div>
            </dl>

            {detail.data.vendor.notes ? (
              <div className="rounded-card border border-line p-3">
                <p className="text-[10px] uppercase tracking-[0.06em] text-muted">Internal notes</p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">{detail.data.vendor.notes}</p>
              </div>
            ) : null}

            <div className="rounded-card bg-surface-muted p-3">
              <p className="text-[10px] uppercase tracking-[0.06em] text-muted">Record</p>
              <p className="mt-1 text-[12px] text-ink-soft">
                {detail.data.vendor.code} · last updated {formatDate(detail.data.vendor.updatedAt)}
              </p>
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
