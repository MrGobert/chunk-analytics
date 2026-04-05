'use client';

interface FunnelStep {
  name: string;
  count: number;
  percentage: number;
  dropoff: number;
}

interface FunnelChartProps {
  data: FunnelStep[];
}

export default function FunnelChart({ data }: FunnelChartProps) {
  if (data.length === 0) {
    return <div className="text-sm text-zinc-500 text-center py-8">No funnel data available</div>;
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="space-y-4 h-full flex flex-col justify-center">
      {data.map((step, index) => {
        const width = maxCount > 0 ? (step.count / maxCount) * 100 : 0;

        return (
          <div key={step.name} className="relative">
            <div className="flex items-center gap-4">
              <div className="w-32 text-sm text-zinc-400 text-right">{step.name}</div>
              <div className="flex-1">
                <div
                  className="h-10 rounded-lg bg-gradient-to-r from-emerald-600/80 to-teal-400/80 flex items-center justify-end pr-3 transition-all backdrop-blur-sm border border-emerald-400/20 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                  style={{ width: `${Math.max(width, 10)}%` }}
                >
                  <span className="text-sm font-medium text-foreground">{step.count.toLocaleString()}</span>
                </div>
              </div>
              <div className="w-20 text-right">
                <span className="text-sm font-medium text-foreground">{step.percentage.toFixed(1)}%</span>
                {index > 0 && step.dropoff > 0 && (
                  <div className="text-xs text-red-400">-{step.dropoff.toFixed(1)}%</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
