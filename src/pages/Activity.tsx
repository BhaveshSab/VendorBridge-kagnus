import { ChevronRight, History, Layers, ShieldCheck, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Page } from "../components/guards";
import {
  Card,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  SkeletonBlock,
} from "../components/ui";
import { formatDateTime, formatNumber } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useDebounced } from "../lib/useDebounced";

interface ActivityActor {
  id: number | null;
  name: string;
  email: string | null;
  role: string;
}

interface ActivityEvent {
  id: number;
  action: string;
  actionLabel: string;
  category: string;
  actor: ActivityActor;
  entityType: string;
  entityId: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface ActivityResponse {
  items: ActivityEvent[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    actions: { value: string; label: string; count: number }[];
    entityTypes: { value: string; count: number }[];
    actors: { id: number; name: string; role: string; count: number }[];
  };
}

interface ActivityDetail {
  event: ActivityEvent;
  related: ActivityEvent[];
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  procurement: "Procurement",
  manager: "Manager",
  vendor: "Vendor",
  anonymous: "Anonymous",
};

const ENTITY_LABELS: Record<string, string> = {
  session: "Session",
  user: "Account",
  vendor: "Vendor",
  rfq: "RFQ",
  quotation: "Quotation",
  approval: "Approval",
  purchase_order: "Purchase order",
  invoice: "Invoice",
};

const CATEGORY_STYLES: Record<string, string> = {
  auth: "bg-slate-100 text-slate-700 border-slate-200",
  vendor: "bg-blue-50 text-blue-700 border-blue-200",
  rfq: "bg-indigo-50 text-indigo-700 border-indigo-200",
  quotation: "bg-cyan-50 text-cyan-700 border-cyan-200",
  approval: "bg-amber-50 text-amber-700 border-amber-200",
  purchase_order: "bg-emerald-50 text-emerald-700 border-emerald-200",
  invoice: "bg-violet-50 text-violet-700 border-violet-200",
};

const RANGES = [
  { value: "all", label: "All time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function rangeFor(value: string) {
  if (value === "all") return {};
  const days = Number(value);
  if (!Number.isFinite(days)) return {};
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: isoDay(from), to: isoDay(to) };
}

function ActionChip({ event }: { event: ActivityEvent }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${
        CATEGORY_STYLES[event.category] || "bg-slate-100 text-slate-700 border-slate-200"
      }`}
    >
      {event.actionLabel}
    </span>
  );
}

export default function Activity() {
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const [entityType, setEntityType] = useState("all");
  const [range, setRange] = useState("30");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const debouncedSearch = useDebounced(search, 300);

  const query = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      action: action === "all" ? undefined : action,
      entityType: entityType === "all" ? undefined : entityType,
      ...rangeFor(range),
      page,
      pageSize: 25,
    }),
    [debouncedSearch, action, entityType, range, page],
  );

  const data = useApi<ActivityResponse>("/activity", query);
  const detail = useApi<ActivityDetail>(selected ? `/activity/${selected}` : null);

  function resetPage() {
    setPage(1);
  }

  const event = detail.data?.event ?? null;

  return (
    <Page>
      <div className="page-shell">
        <PageHeader
          eyebrow="Governance"
          title="Activity & audit trail"
          description="Every state-changing action — sign-ins, vendor edits, RFQ lifecycle, approvals, purchase orders and invoice delivery — recorded with who did it and when. Entries are append-only and cannot be edited or deleted."
          actions={
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700">
              <ShieldCheck size={13} /> Append-only
            </span>
          }
        />

        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              resetPage();
            }}
            placeholder="Search action, person, record…"
            className="w-full sm:w-72"
          />
          <Select
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              resetPage();
            }}
            aria-label="Filter by action"
            className="input-sm w-auto font-medium"
          >
            <option value="all">All actions</option>
            {data.data?.facets.actions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.count})
              </option>
            ))}
          </Select>
          <Select
            value={entityType}
            onChange={(event) => {
              setEntityType(event.target.value);
              resetPage();
            }}
            aria-label="Filter by record type"
            className="input-sm w-auto font-medium"
          >
            <option value="all">All record types</option>
            {data.data?.facets.entityTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {ENTITY_LABELS[option.value] || option.value} ({option.count})
              </option>
            ))}
          </Select>
          <Select
            value={range}
            onChange={(event) => {
              setRange(event.target.value);
              resetPage();
            }}
            aria-label="Filter by date range"
            className="input-sm w-auto font-medium"
          >
            {RANGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <span className="ml-auto text-[11px] font-semibold text-muted">
            {data.data ? `${formatNumber(data.data.total)} entr${data.data.total === 1 ? "y" : "ies"}` : "—"}
          </span>
        </div>

        <Card className="overflow-hidden">
          {data.loading && !data.data ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <SkeletonBlock key={row} className="h-12" />
              ))}
            </div>
          ) : data.error ? (
            <div className="p-4">
              <ErrorState message={data.error.message} onRetry={data.refetch} />
            </div>
          ) : (data.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon={<History size={22} />}
              title="No activity in this view"
              description="Try a wider date range or clear the filters. New actions appear here as soon as they happen."
            />
          ) : (
            <>
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-36">When</th>
                      <th>Action</th>
                      <th className="hidden sm:table-cell">Actor</th>
                      <th className="hidden lg:table-cell">Record</th>
                      <th>Summary</th>
                      <th className="hidden xl:table-cell">Source</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.data?.items.map((row) => (
                      <tr
                        key={row.id}
                        className="cursor-pointer transition-colors hover:bg-slate-50/80"
                        onClick={() => setSelected(row.id)}
                      >
                        <td className="whitespace-nowrap text-[11px] font-medium text-muted">
                          {formatDateTime(row.createdAt)}
                        </td>
                        <td>
                          <ActionChip event={row} />
                        </td>
                        <td className="hidden sm:table-cell">
                          <p className="text-[12px] font-bold text-ink">{row.actor.name}</p>
                          <p className="text-[10px] font-medium text-muted">
                            {ROLE_LABELS[row.actor.role] || row.actor.role}
                          </p>
                        </td>
                        <td className="hidden lg:table-cell">
                          <span className="text-[12px] font-semibold text-ink-soft">
                            {ENTITY_LABELS[row.entityType] || row.entityType}
                          </span>
                          {row.entityId ? (
                            <span className="ml-1 font-mono text-[11px] text-muted">#{row.entityId}</span>
                          ) : null}
                        </td>
                        <td className="max-w-[420px]">
                          <p className="truncate text-[12px] font-medium text-ink-soft" title={row.summary}>
                            {row.summary}
                          </p>
                        </td>
                        <td className="hidden font-mono text-[11px] text-muted xl:table-cell">
                          {row.ipAddress || "—"}
                        </td>
                        <td className="text-right text-slate-300">
                          <ChevronRight size={14} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={data.data?.page ?? 1}
                pageSize={data.data?.pageSize ?? 25}
                total={data.data?.total ?? 0}
                onPageChange={setPage}
              />
            </>
          )}
        </Card>

        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          The audit trail keeps a snapshot of the actor's name and role, so history stays readable even if an account is
          later removed. IP addresses are recorded from the request and shown to procurement staff only.
        </p>
      </div>

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={event ? event.actionLabel : "Audit entry"}
        description={event ? `${formatDateTime(event.createdAt)} · ${ENTITY_LABELS[event.entityType] || event.entityType}${event.entityId ? ` #${event.entityId}` : ""}` : undefined}
        size="lg"
      >
        {detail.loading && !event ? (
          <div className="space-y-2">
            <SkeletonBlock className="h-6 w-2/3" />
            <SkeletonBlock className="h-20" />
          </div>
        ) : detail.error ? (
          <ErrorState message={detail.error.message} onRetry={detail.refetch} />
        ) : event ? (
          <div className="space-y-5">
            <div>
              <p className="text-[13px] font-semibold leading-relaxed text-ink">{event.summary}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <UserRound size={13} />
                  <span className="font-bold text-ink-soft">{event.actor.name}</span>
                  {event.actor.email ? <span>· {event.actor.email}</span> : null}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Layers size={13} />
                  {ROLE_LABELS[event.actor.role] || event.actor.role}
                </span>
                <span className="font-mono">{event.ipAddress || "no address"}</span>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Details</p>
              {event.metadata ? (
                <pre className="scrollbar-thin max-h-64 overflow-auto rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-[11px] leading-relaxed text-slate-700">
                  {JSON.stringify(event.metadata, null, 2)}
                </pre>
              ) : (
                <p className="text-[12px] text-muted">No additional fields were recorded for this action.</p>
              )}
              {event.userAgent ? (
                <p className="mt-2 truncate font-mono text-[10px] text-slate-400" title={event.userAgent}>
                  {event.userAgent}
                </p>
              ) : null}
            </div>

            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                Related history for this record
              </p>
              {detail.data && detail.data.related.length > 0 ? (
                <ul className="space-y-2">
                  {detail.data.related.map((row) => (
                    <li key={row.id} className="flex items-start gap-2.5 rounded-lg border border-slate-200/80 px-3 py-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-semibold text-ink">{row.actionLabel}</p>
                        <p className="text-[11px] text-muted">{row.summary}</p>
                      </div>
                      <span className="shrink-0 text-[10px] font-medium text-muted">
                        {formatDateTime(row.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-muted">This is the only recorded action for this record so far.</p>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </Page>
  );
}
