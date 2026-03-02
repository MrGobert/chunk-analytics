import { formatNumber, formatPercentage } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: number | string;
  trend?: number | null;
  format?: 'number' | 'percentage' | 'ratio' | 'decimal' | 'text';
  subtitle?: string;
  icon?: React.ReactNode;
}

export default function StatCard({ title, value, trend, format = 'number', subtitle, icon }: StatCardProps) {
  const getFormattedValue = () => {
    if (format === 'text' || typeof value === 'string') return value;
    if (format === 'percentage') return formatPercentage(value as number);
    if (format === 'ratio') return (value as number).toFixed(2);
    if (format === 'decimal') return (value as number).toFixed(1);
    return formatNumber(value as number);
  };

  const formattedValue = getFormattedValue();
  const isNewTrend = trend === null;
  const trendColor = isNewTrend ? 'text-accent' : (trend !== undefined && trend >= 0 ? 'text-[#34D399]' : 'text-accent');
  const trendIcon = isNewTrend ? '' : (trend !== undefined && trend >= 0 ? '↑' : '↓');

  return (
    <div className="card-animate rounded-[2rem] bg-primary border border-zinc-300/50 p-5 sm:p-7 shadow-sm transition-transform duration-300 hover:-translate-y-1">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-bold tracking-tight text-zinc-600 font-sans">{title}</span>
        {icon && <div className="text-zinc-500 hidden sm:block">{icon}</div>}
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-3xl sm:text-4xl font-bold font-mono text-foreground tracking-tight">{formattedValue}</span>
        <div className="flex flex-col">
          {isNewTrend && (
            <span className={`text-sm font-mono font-medium ${trendColor}`}>New</span>
          )}
          {trend !== undefined && trend !== null && (
            <span className={`text-sm font-mono font-medium ${trendColor}`}>
              {trendIcon} {Math.abs(trend).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
      {subtitle && (
        <div className="mt-2 text-xs font-mono text-zinc-500 uppercase tracking-widest">{subtitle}</div>
      )}
    </div>
  );
}
