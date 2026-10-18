import { formatNumber } from "../lib/format";

const DONUT_COLORS = [
  "#2563eb", // Vibrant Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#6366f1", // Indigo
  "#f43f5e", // Rose
  "#06b6d4", // Cyan
];

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
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90 drop-shadow-xs" role="img" aria-label="Distribution chart">
          <circle cx="21" cy="21" r="15.915" fill="none" stroke="#f1f5f9" strokeWidth="6" />
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
                strokeLinecap="round"
                className="transition-all duration-500 ease-out"
              />
            );
            offset += percent;
            return circle;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">{totalLabel}</span>
          <span className="text-base font-extrabold text-ink tracking-tight">{totalValue}</span>
        </div>
      </div>
      <ul className="w-full space-y-2.5">
        {segments.map((segment, index) => {
          const color = DONUT_COLORS[index % DONUT_COLORS.length];
          const percent = Math.round((segment.value / total) * 100);
          return (
            <li key={segment.label} className="flex items-center justify-between gap-3 text-[12px] p-1.5 rounded-lg hover:bg-slate-50 transition-colors">
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full shadow-xs"
                  style={{ background: color }}
                />
                <span className="truncate font-medium text-ink-soft">{segment.label}</span>
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-medium text-muted">{percent}%</span>
                <span className="font-bold text-ink bg-slate-100 px-2 py-0.5 rounded-md text-[11px]">{formatNumber(segment.value)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
