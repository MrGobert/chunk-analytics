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
    return <div className="empty-state py-8">No funnel data available</div>;
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="space-y-4 h-full flex flex-col justify-center">
      {data.map((step, index) => {
        const width = maxCount > 0 ? (step.count / maxCount) * 100 : 0;
        const labelInside = width >= 18;

        return (
          <div key={step.name} className="relative">
            <div className="flex items-center gap-4">
              <div className="w-32 text-sm text-ink-soft text-right">{step.name}</div>
              <div className="flex-1">
                <div
                  className="h-10 rounded-chip bg-lake border border-line flex items-center justify-end pr-3 transition-all"
                  style={{ width: `${Math.max(width, 8)}%` }}
                >
                  {labelInside && (
                    <span className="text-sm font-semibold text-[#F6EFE4] tabular-nums">
                      {step.count.toLocaleString()}
                    </span>
                  )}
                </div>
                {!labelInside && (
                  <span className="ml-2 text-sm font-semibold text-ink tabular-nums">
                    {step.count.toLocaleString()}
                  </span>
                )}
              </div>
              <div className="w-20 text-right">
                <span className="text-sm font-medium text-ink tabular-nums">{step.percentage.toFixed(1)}%</span>
                {index > 0 && step.dropoff > 0 && (
                  <div className="text-xs text-ember-deep tabular-nums">-{step.dropoff.toFixed(1)}%</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
