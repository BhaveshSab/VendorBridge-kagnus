import { ArrowUpRight, ClipboardList, Clock, Plus, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  StatCard,
  Tabs,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { RFQ_STATUS_TABS } from "../lib/constants";
import { deadlineMeta, formatDate, formatMoney } from "../lib/format";
import type { RfqSummary } from "../lib/types";
import { useApi } from "../lib/useApi";
import { useDebounced } from "../lib/useDebounced";

interface RfqListResponse {
  items: RfqSummary[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
}

const PAGE_SIZE = 8;

function statusLabel(rfq: RfqSummary) {
  return rfq.effectiveStatus.charAt(0).toUpperCase() + rfq.effectiveStatus.slice(1);
}

export default function RfqList() {
  const { user, permissions } = useAuth();
  const isVendor = user?.role === "vendor";
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("deadline");
  const [page, setPage] = useState(1);

  const list = useApi<RfqListResponse>("/rfqs", {
    search: debouncedSearch,
    status,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, sort]);

  const counts = list.data?.statusCounts ?? {};
  const totalRfqs = ["draft", "open", "expired", "closed", "cancelled"].reduce(
    (sum, key) => sum + (counts[key] ?? 0),
    0,
  );

  const tabs = RFQ_STATUS_TABS.map((tab) => ({
    ...tab,
    count: tab.value === "all" ? totalRfqs : counts[tab.value] ?? 0,
  }));

  const hasFilters = Boolean(debouncedSearch) || status !== "all" || sort !== "deadline";

  function resetFilters() {
    setSearch("");
    setStatus("all");
    setSort("deadline");
  }

  return (
    <Page>
      <div className="page-shell">
        <PageHeader
          eyebrow={isVendor ? "Invitations to quote" : "Requests for quotation"}
          title={isVendor ? "My RFQs" : "RFQs & Quotations"}
          description={
            isVendor
              ? "RFQs assigned to your vendor record. Submit one quotation per RFQ and revise it until the deadline."
              : "Publish requirements, invite suppliers and review the quotations they submit."
          }
          actions={
            permissions?.manageRfqs ? (
              <Button size="sm" icon={<Plus size={15} />} onClick={() => navigate("/rfqs/new")}>
                Create RFQ
              </Button>
            ) : null
          }
        />

        <div className="mb-4 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <StatCard
            label="Open now"
            value={counts.open ?? 0}
            hint={isVendor ? "Accepting your quotation" : "Accepting quotations"}
            icon={<Clock size={16} />}
          />
          <StatCard
            label="Expired"
            value={counts.expired ?? 0}
            hint="Deadline passed, not yet closed"
            icon={<ClipboardList size={16} />}
          />
          <StatCard label="Draft" value={counts.draft ?? 0} hint="Not visible to vendors" icon={<ClipboardList size={16} />} />
          <StatCard
            label="Closed / cancelled"
            value={(counts.closed ?? 0) + (counts.cancelled ?? 0)}
            hint="No longer accepting submissions"
            icon={<ClipboardList size={16} />}
          />
        </div>

        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line bg-slate-50/40 p-4 lg:flex-row lg:items-center">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search reference, title or scope…"
              className="lg:w-80"
            />
            <div className="flex flex-wrap items-center gap-2.5 lg:ml-auto">
              <Select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                aria-label="Sort RFQs"
                className="input-sm font-medium"
              >
                <option value="deadline">Deadline (soonest)</option>
                <option value="created">Newest first</option>
                <option value="reference">Reference A–Z</option>
                <option value="title">Title A–Z</option>
              </Select>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold text-brand-600 transition-colors hover:bg-blue-50 hover:text-brand-700"
                >
                  <RotateCcw size={12} /> Reset
                </button>
              ) : null}
            </div>
          </div>

          <div className="px-4 pt-2">
            <Tabs tabs={tabs} value={status} onChange={setStatus} />
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
              icon={<ClipboardList size={20} />}
              title={hasFilters ? "No RFQs match those filters" : isVendor ? "No RFQs assigned yet" : "No RFQs yet"}
              description={
                hasFilters
                  ? "Try a different search, status or sort order."
                  : isVendor
                    ? "When procurement assigns an RFQ to your vendor record it will appear here."
                    : "Create an RFQ, add line items and assign vendors to start collecting quotations."
              }
              action={
                hasFilters ? (
                  <Button variant="ghost" size="sm" onClick={resetFilters}>
                    Clear filters
                  </Button>
                ) : permissions?.manageRfqs ? (
                  <Button size="sm" icon={<Plus size={14} />} onClick={() => navigate("/rfqs/new")}>
                    Create RFQ
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
                      <th>RFQ</th>
                      <th className="hidden sm:table-cell">Items</th>
                      <th className="hidden md:table-cell">Vendors</th>
                      <th className="hidden lg:table-cell">{isVendor ? "Your quotation" : "Quotations"}</th>
                      <th>Deadline</th>
                      <th>Status</th>
                      <th className="text-right">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data?.items.map((rfq) => {
                      const deadline = deadlineMeta(rfq.deadline);
                      return (
                        <tr
                          key={rfq.id}
                          className="group cursor-pointer"
                          onClick={() => navigate(`/rfqs/${rfq.id}`)}
                        >
                          <td>
                            <div className="flex items-start gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-200/60 bg-gradient-to-tr from-brand-50 to-indigo-50 text-brand-700 shadow-xs">
                                <ClipboardList size={16} aria-hidden />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate font-bold text-ink transition-colors group-hover:text-brand-600">
                                  {rfq.title}
                                </p>
                                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-semibold text-slate-700">
                                    {rfq.reference}
                                  </span>
                                  {isVendor && rfq.myQuotation ? (
                                    <span>{formatMoney(rfq.myQuotation.total, rfq.currency)}</span>
                                  ) : null}
                                  <span className="hidden sm:inline">· {rfq.creatorName || "Procurement"}</span>
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="hidden text-[12px] font-semibold text-ink-soft sm:table-cell">
                            {rfq.itemCount}
                          </td>
                          <td className="hidden text-[12px] font-semibold text-ink-soft md:table-cell">
                            {rfq.vendorCount}
                          </td>
                          <td className="hidden lg:table-cell">
                            {isVendor ? (
                              rfq.hasSubmitted ? (
                                <span className="badge badge-submitted">
                                  Submitted · rev {rfq.myQuotation?.revision ?? 1}
                                </span>
                              ) : (
                                <span className="badge badge-pending">Not submitted</span>
                              )
                            ) : (
                              <span className="text-[12px] font-semibold text-ink-soft">{rfq.quotationCount}</span>
                            )}
                          </td>
                          <td>
                            <p className="text-[12px] font-semibold text-ink">{formatDate(rfq.deadline)}</p>
                            <p
                              className={`mt-0.5 text-[11px] font-medium ${
                                deadline.expired ? "text-orange-600" : "text-muted"
                              }`}
                            >
                              {deadline.label}
                            </p>
                          </td>
                          <td>
                            <Badge status={statusLabel(rfq)} />
                          </td>
                          <td className="text-right">
                            <Link
                              to={`/rfqs/${rfq.id}`}
                              onClick={(event) => event.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 hover:text-brand-700"
                            >
                              View <ArrowUpRight size={13} />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
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

        {isVendor ? (
          <p className="mt-4 text-[11px] leading-relaxed text-muted">
            You only see RFQs assigned to your vendor record. Prices and notes submitted by other suppliers are never
            shown to you.
          </p>
        ) : null}
      </div>
    </Page>
  );
}
