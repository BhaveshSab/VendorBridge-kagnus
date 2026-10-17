import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { statusClass } from "../lib/format";

export function cn(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "ghost" | "danger" | "danger-ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  ghost: "btn-ghost",
  danger: "btn-danger",
  "danger-ghost": "btn-danger-ghost",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn("btn", variantClass[variant], size === "sm" && "btn-sm", size === "lg" && "btn-lg", className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button type="button" className={cn("icon-btn", className)} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("card", className)}>{children}</div>;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  trend,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  trend?: { value: string; positive?: boolean };
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{label}</p>
        {icon ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-card bg-brand-50 text-brand-600">
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">{value}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
        {trend ? (
          <span
            className={cn(
              "text-[11px] font-semibold",
              trend.positive === false ? "text-danger" : "text-success",
            )}
          >
            {trend.value}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-[13px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Badge({ status, className }: { status: string; className?: string }) {
  return <span className={cn(statusClass(status), className)}>{status}</span>;
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label?: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {label ? (
        <label className="label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="ml-1 text-danger">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ invalid, className, ...rest }: InputProps) {
  return <input className={cn("input", className)} aria-invalid={invalid || undefined} {...rest} />;
}

export function Select({
  invalid,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select className={cn("input", className)} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({
  invalid,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className={cn("input", className)} aria-invalid={invalid || undefined} {...rest} />;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search
        size={14}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        aria-hidden
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="input pl-8 pr-8"
        aria-label={placeholder}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-chip text-muted hover:text-ink"
          aria-label="Clear search"
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
}

export interface TabOption {
  value: string;
  label: string;
  count?: number;
}

export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: TabOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1 border-b border-line", className)} role="tablist">
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
              active
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-muted hover:border-line-strong hover:text-ink",
            )}
          >
            {tab.label}
            {tab.count != null ? (
              <span
                className={cn(
                  "rounded-chip px-1.5 py-0.5 text-[10px] font-semibold",
                  active ? "bg-brand-50 text-brand-700" : "bg-neutral-soft text-muted",
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted" role="status">
      <Loader2 size={18} className="spin text-brand-600" aria-hidden />
      <span className="text-[13px]">{label}…</span>
    </div>
  );
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4 w-full", className)} />;
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 px-4 py-12 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-card bg-danger-soft text-danger">
        <AlertTriangle size={18} aria-hidden />
      </span>
      <div>
        <p className="text-[13px] font-semibold text-ink">Something went wrong</p>
        <p className="mt-1 max-w-md text-xs text-muted">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center text-center", compact ? "px-4 py-8" : "px-4 py-16")}>
      {icon ? (
        <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-card bg-brand-50 text-brand-600">
          {icon}
        </span>
      ) : null}
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  const widths = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <motion.div
            className="absolute inset-0 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={cn(
              "relative flex max-h-[92vh] w-full flex-col border border-line-strong bg-surface",
              widths[size],
            )}
            style={{ borderRadius: "16px 16px 0 0" }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-4 sm:px-5">
              <div>
                <h2 id={titleId} className="text-[15px] font-semibold text-ink">
                  {title}
                </h2>
                {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
              </div>
              <IconButton label="Close dialog" onClick={onClose} className="-mr-1 -mt-1">
                <X size={16} />
              </IconButton>
            </div>
            <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
            {footer ? (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-muted px-4 py-3 sm:px-5">
                {footer}
              </div>
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  loading = false,
  tone = "danger",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  tone?: "danger" | "primary";
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} size="sm" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-ink-soft">{message}</p>
    </Modal>
  );
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-7 w-7 text-[10px]", md: "h-8 w-8 text-[11px]", lg: "h-10 w-10 text-[13px]" };
  const label = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700",
        sizes[size],
      )}
      aria-hidden
    >
      {label || "VB"}
    </span>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t border-line px-4 py-3 sm:flex-row">
      <p className="text-[11px] text-muted">
        Showing <span className="font-semibold text-ink-soft">{start}–{end}</span> of{" "}
        <span className="font-semibold text-ink-soft">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <IconButton label="Previous page" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          <ChevronLeft size={14} />
        </IconButton>
        <span className="px-2 text-[11px] font-medium text-ink-soft">
          Page {page} of {pages}
        </span>
        <IconButton label="Next page" onClick={() => onPageChange(page + 1)} disabled={page >= pages}>
          <ChevronRight size={14} />
        </IconButton>
      </div>
    </div>
  );
}

export function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">{label}</dt>
      <dd className="mt-1 text-[13px] font-medium text-ink">{children}</dd>
    </div>
  );
}

export function ProgressBar({ value, tone = "brand" }: { value: number; tone?: "brand" | "warning" | "danger" }) {
  const colors = { brand: "bg-brand-600", warning: "bg-warning", danger: "bg-danger" };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-chip bg-neutral-soft" role="presentation">
      <div className={cn("h-full", colors[tone])} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function CopyInline({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      className="text-[11px] font-medium text-muted transition-colors hover:text-brand-700"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
