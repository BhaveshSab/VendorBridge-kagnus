import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCheck, Inbox } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { cn, IconButton } from "./ui";

interface Notification {
  id: number;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationList {
  items: Notification[];
  total: number;
  unread: number;
}

const POLL_MS = 30_000;

export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    try {
      const result = await api.get<{ count: number }>("/notifications/unread-count");
      setUnread(result.count);
    } catch {
      // A failed poll is not worth interrupting the page for; the next one retries.
    }
  }, []);

  const refreshList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.get<NotificationList>("/notifications", { filter, pageSize: 20 });
      setItems(result.items);
      setUnread(result.unread);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    refreshCount();
    const timer = window.setInterval(refreshCount, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    refreshList();
  }, [open, refreshList]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markRead(notification: Notification) {
    if (!notification.readAt) {
      try {
        await api.post(`/notifications/${notification.id}/read`);
        setItems((current) =>
          current.map((row) => (row.id === notification.id ? { ...row, readAt: new Date().toISOString() } : row)),
        );
        setUnread((current) => Math.max(0, current - 1));
      } catch {
        // Navigating is still useful even if the read flag could not be saved.
      }
    }
    setOpen(false);
    if (notification.link) navigate(notification.link);
  }

  async function markAllRead() {
    try {
      await api.post("/notifications/read-all");
      setItems((current) =>
        filter === "unread"
          ? []
          : current.map((row) => ({ ...row, readAt: row.readAt ?? new Date().toISOString() })),
      );
      setUnread(0);
    } catch (markError) {
      setError(errorMessage(markError));
    }
  }

  return (
    <div className="relative" ref={ref}>
      <IconButton
        label="Notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className="relative text-slate-300 hover:bg-slate-800 hover:text-white"
      >
        <Bell size={18} />
        {unread > 0 ? (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-slate-900"
            aria-label={`${unread} unread notifications`}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </IconButton>

      <AnimatePresence>
        {open ? (
          <motion.div
            role="dialog"
            aria-label="Notifications"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-[calc(100%+10px)] z-50 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
              <div>
                <p className="text-[13px] font-bold text-ink">Notifications</p>
                <p className="text-[11px] text-muted">{unread > 0 ? `${unread} unread` : "You're all caught up"}</p>
              </div>
              <button
                type="button"
                onClick={markAllRead}
                disabled={unread === 0}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                <CheckCheck size={13} aria-hidden />
                Mark all read
              </button>
            </div>

            <div className="flex gap-1 border-b border-slate-100 px-3 py-2">
              {(["all", "unread"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors",
                    filter === value ? "bg-brand-600 text-white" : "text-muted hover:bg-slate-100 hover:text-ink",
                  )}
                >
                  {value === "all" ? "All" : "Unread"}
                </button>
              ))}
            </div>

            <div className="scrollbar-thin max-h-[360px] overflow-y-auto">
              {loading ? (
                <p className="px-4 py-8 text-center text-[12px] text-muted" role="status">
                  Loading notifications…
                </p>
              ) : error ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-[12px] text-danger">{error}</p>
                  <button
                    type="button"
                    onClick={refreshList}
                    className="mt-2 text-[11px] font-semibold text-brand-700 hover:underline"
                  >
                    Try again
                  </button>
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center px-4 py-9 text-center">
                  <Inbox size={22} className="text-slate-300" aria-hidden />
                  <p className="mt-2 text-[12px] font-semibold text-ink">Nothing here yet</p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    New RFQs, quotations, decisions and invoices will appear here.
                  </p>
                </div>
              ) : (
                <ul>
                  {items.map((notification) => (
                    <li key={notification.id} className="border-b border-slate-100 last:border-b-0">
                      <button
                        type="button"
                        onClick={() => markRead(notification)}
                        className={cn(
                          "flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-slate-50",
                          !notification.readAt && "bg-blue-50/40",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                            notification.readAt ? "bg-transparent" : "bg-brand-600",
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[12px] font-bold text-ink">{notification.title}</span>
                            <span className="shrink-0 text-[10px] text-muted">{formatDateTime(notification.createdAt)}</span>
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{notification.body}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
