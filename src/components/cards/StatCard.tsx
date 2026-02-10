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
  const trendColor = isNewTrend ? 'text-blue-400' : (trend !== undefined && trend >= 0 ? 'text-emerald-400' : 'text-red-400');
  const trendIcon = isNewTrend ? '' : (trend !== undefined && trend >= 0 ? '↑' : '↓');

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs sm:text-sm font-medium text-zinc-400">{title}</span>
        {icon && <div className="text-zinc-500 hidden sm:block">{icon}</div>}
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl sm:text-3xl font-bold text-white">{formattedValue}</span>
        {isNewTrend && (
          <span className={`text-sm font-medium ${trendColor} mb-1`}>New</span>
        )}
        {trend !== undefined && trend !== null && (
          <span className={`text-sm font-medium ${trendColor} mb-1`}>
            {trendIcon} {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      {subtitle && (
        <div className="mt-1 text-xs text-zinc-500">{subtitle}</div>
      )}
    </div>
  );
}
