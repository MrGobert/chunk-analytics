'use client';

interface HeatmapChartProps {
  data: { hour: number; count: number }[];
}

export default function HeatmapChart({ data }: HeatmapChartProps) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  const getIntensity = (count: number) => {
    const ratio = count / maxCount;
    if (ratio === 0) return 'bg-zinc-800';
    if (ratio < 0.25) return 'bg-violet-900/50';
    if (ratio < 0.5) return 'bg-violet-700/60';
    if (ratio < 0.75) return 'bg-violet-600/70';
    return 'bg-violet-500';
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
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
              {formatHour(item.hour)}: {item.count} searches
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-3 text-xs text-zinc-500">
        <span>12am</span>
        <span>6am</span>
        <span>12pm</span>
        <span>6pm</span>
        <span>11pm</span>
      </div>
      <div className="flex items-center justify-center gap-2 mt-4">
        <span className="text-xs text-zinc-500">Less</span>
        <div className="flex gap-1">
          <div className="w-4 h-4 rounded bg-zinc-800" />
          <div className="w-4 h-4 rounded bg-violet-900/50" />
          <div className="w-4 h-4 rounded bg-violet-700/60" />
          <div className="w-4 h-4 rounded bg-violet-600/70" />
          <div className="w-4 h-4 rounded bg-violet-500" />
        </div>
        <span className="text-xs text-zinc-500">More</span>
      </div>
    </div>
  );
}
