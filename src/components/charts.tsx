import { formatNumber } from "../lib/format";

const DONUT_COLORS = ["#186346", "#4d9a79", "#8dbfa6", "#cbd5ce", "#a9751a"];

export function DonutChart({
  segments,
  totalLabel,
  totalValue,
}: {
  segments: { label: string; value: number }[];
  totalLabel: string;
  totalValue: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90" role="img" aria-label="Distribution chart">
          <circle cx="21" cy="21" r="15.915" fill="none" stroke="#eef1ef" strokeWidth="6" />
          {segments.map((segment, index) => {
            const percent = (segment.value / total) * 100;
            const dash = `${Math.max(0, percent)} ${100 - Math.max(0, percent)}`;
            const circle = (
              <circle
                key={segment.label}
                cx="21"
                cy="21"
                r="15.915"
                fill="none"
                stroke={DONUT_COLORS[index % DONUT_COLORS.length]}
                strokeWidth="6"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              />
            );
            offset += percent;
            return circle;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] uppercase tracking-[0.05em] text-muted">{totalLabel}</span>
          <span className="text-sm font-semibold text-ink">{totalValue}</span>
        </div>
      </div>
      <ul className="w-full space-y-2">
        {segments.map((segment, index) => (
          <li key={segment.label} className="flex items-center justify-between gap-2 text-[12px]">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-chip"
                style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }}
              />
              <span className="truncate text-ink-soft">{segment.label}</span>
            </span>
            <span className="shrink-0 font-semibold text-ink">{formatNumber(segment.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
