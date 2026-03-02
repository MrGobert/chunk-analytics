interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

function Skeleton({ className = '', style }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-zinc-800/60 ${className}`}
      style={style}
    />
  );
}

export function SkeletonStatCard() {
  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-5 rounded hidden sm:block" />
      </div>
      <div className="flex items-end gap-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-4 w-12 mb-1" />
      </div>
    </div>
  );
}

export function SkeletonChartCard() {
  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 sm:p-6">
      <div className="mb-3 sm:mb-4">
        <Skeleton className="h-5 w-40 mb-2" />
        <Skeleton className="h-3 w-56" />
      </div>
      <div className="h-[250px] sm:h-[300px] flex flex-col justify-end gap-2 px-4">
        <div className="flex items-end gap-1 h-full">
          {[40, 65, 45, 80, 55, 70, 50, 85, 60, 75, 45, 90].map((h, i) => (
            <Skeleton
              key={i}
              className="flex-1 rounded-t-sm"
              style={{ height: `${h}%` } as React.CSSProperties}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface SkeletonPageProps {
  statCards?: number;
  statCardCols?: string;
  chartCards?: number;
  chartCardLayout?: string;
}

export function SkeletonPage({
  statCards = 4,
  statCardCols = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  chartCards = 2,
  chartCardLayout = 'grid-cols-1 lg:grid-cols-2',
}: SkeletonPageProps) {
  return (
    <div className="animate-in fade-in duration-200">
      {/* Header skeleton */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <Skeleton className="h-7 w-48 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
      </div>

      {/* Stat cards */}
      {statCards > 0 && (
        <div className={`grid ${statCardCols} gap-6 mb-8`}>
          {Array.from({ length: statCards }).map((_, i) => (
            <SkeletonStatCard key={i} />
          ))}
        </div>
      )}

      {/* Chart cards */}
      {chartCards > 0 && (
        <div className={`grid ${chartCardLayout} gap-6 mb-8`}>
          {Array.from({ length: chartCards }).map((_, i) => (
            <SkeletonChartCard key={i} />
          ))}
        </div>
      )}
    </div>
  );
}

export default Skeleton;
