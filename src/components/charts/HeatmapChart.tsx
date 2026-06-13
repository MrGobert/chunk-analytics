'use client';

interface HeatmapChartProps {
  data: { hour: number; count: number }[];
  /** Noun shown in the hover tooltip (e.g. "searches", "sessions"). */
  unit?: string;
}

export default function HeatmapChart({ data, unit = 'searches' }: HeatmapChartProps) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  // Lake intensity ramp — calm, large-area-safe on cream.
  const getIntensity = (count: number) => {
    const ratio = count / maxCount;
    if (ratio === 0) return 'bg-paper-deep border border-line';
    if (ratio < 0.25) return 'bg-lake-tint';
    if (ratio < 0.5) return 'bg-lake/40';
    if (ratio < 0.75) return 'bg-lake/70';
    return 'bg-lake';
  };

  const formatHour = (hour: number) => {
    if (hour === 0) return '12am';
    if (hour === 12) return '12pm';
    if (hour < 12) return `${hour}am`;
    return `${hour - 12}pm`;
  };

  return (
    <div className="h-full flex flex-col justify-center">
      <div className="grid grid-cols-12 gap-1">
        {data.slice(0, 24).map((item) => (
          <div
            key={item.hour}
            className={`aspect-square rounded-md ${getIntensity(item.count)} flex items-center justify-center group relative cursor-default`}
          >
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-card border border-line shadow-card rounded-chip px-2 py-1 text-xs text-ink opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
              {formatHour(item.hour)}: {item.count} {unit}
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-3 text-xs text-ink-faint">
        <span>12am</span>
        <span>6am</span>
        <span>12pm</span>
        <span>6pm</span>
        <span>11pm</span>
      </div>
      <div className="flex items-center justify-center gap-2 mt-4">
        <span className="text-xs text-ink-faint">Less</span>
        <div className="flex gap-1">
          <div className="w-4 h-4 rounded bg-paper-deep border border-line" />
          <div className="w-4 h-4 rounded bg-lake-tint" />
          <div className="w-4 h-4 rounded bg-lake/40" />
          <div className="w-4 h-4 rounded bg-lake/70" />
          <div className="w-4 h-4 rounded bg-lake" />
        </div>
        <span className="text-xs text-ink-faint">More</span>
      </div>
    </div>
  );
}
