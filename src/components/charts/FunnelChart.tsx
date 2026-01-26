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
  const maxCount = Math.max(...data.map((d) => d.count));

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
                  className="h-10 rounded-lg bg-gradient-to-r from-violet-600 to-purple-500 flex items-center justify-end pr-3 transition-all"
                  style={{ width: `${Math.max(width, 10)}%` }}
                >
                  <span className="text-sm font-medium text-white">{step.count.toLocaleString()}</span>
                </div>
              </div>
              <div className="w-20 text-right">
                <span className="text-sm font-medium text-white">{step.percentage.toFixed(1)}%</span>
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
