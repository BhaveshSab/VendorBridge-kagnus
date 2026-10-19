export function formatDate(value: string | null | undefined, { withTime = false } = {}) {
  if (!value) return "—";
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("en-IN").format(Number(value || 0));
}

export function formatMoney(value: string | number | null | undefined, currency = "INR") {
  if (value == null || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatDateTime(value: string | null | undefined) {
  return formatDate(value, { withTime: true });
}

/** Convert an ISO timestamp into the value format required by datetime-local. */
export function toDateTimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Convert a datetime-local value (local time) into a UTC ISO string. */
export function fromDateTimeLocal(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function deadlineMeta(value: string | null | undefined) {
  if (!value) return { expired: true, label: "No deadline", daysLeft: 0 };
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return { expired: true, label: "Invalid deadline", daysLeft: 0 };
  const diff = target - Date.now();
  if (diff <= 0) return { expired: true, label: "Deadline passed", daysLeft: 0 };
  const days = Math.ceil(diff / 86_400_000);
  const hours = Math.ceil(diff / 3_600_000);
  return {
    expired: false,
    daysLeft: days,
    label: days >= 2 ? `${days} days left` : hours >= 1 ? `${hours} hour${hours === 1 ? "" : "s"} left` : "Closing soon",
  };
}

export function initials(name: string | null | undefined) {
  if (!name) return "VB";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function statusClass(status: string | null | undefined) {
  const key = String(status || "")
    .toLowerCase()
    .replace(/\s+/g, "-");
  return `badge badge-${key}`;
}
