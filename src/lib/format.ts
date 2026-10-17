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
