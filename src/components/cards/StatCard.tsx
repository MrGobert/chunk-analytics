import { formatNumber, formatPercentage } from '@/lib/utils';
import AnimatedNumber from '@/components/ui/AnimatedNumber';

interface StatCardProps {
  title: string;
  value: number | string;
  trend?: number | null;
  format?: 'number' | 'percentage' | 'ratio' | 'decimal' | 'text' | 'currency';
  subtitle?: string;
  icon?: React.ReactNode;
  prefix?: string;
  suffix?: string;
}

export default function StatCard({ title, value, trend, format = 'number', subtitle, icon, prefix = '', suffix = '' }: StatCardProps) {
  const getFormattedValue = () => {
    if (format === 'text' || typeof value === 'string') return value;
    if (format === 'currency') return '$' + (value as number).toFixed(2);
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
    <div className="card-animate rounded-[1.5rem] bg-primary/60 backdrop-blur-xl border border-white/5 p-5 sm:p-7 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)] hover:border-white/10 group">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-bold tracking-tight text-zinc-400 font-sans group-hover:text-zinc-300 transition-colors">{title}</span>
        {icon && <div className="text-zinc-500 hidden sm:block opacity-60 group-hover:opacity-100 transition-opacity">{icon}</div>}
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-3xl sm:text-4xl font-bold font-mono text-foreground tracking-tight">
          {typeof value === 'number' && format !== 'text' ? (
            <AnimatedNumber value={value} format={format} prefix={prefix} suffix={suffix} />
          ) : (
            formattedValue
          )}
        </span>
        <div className="flex flex-col justify-end pb-1">
          {isNewTrend && (
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-accent/10 text-accent border border-accent/20`}>New</span>
          )}
          {trend !== undefined && trend !== null && (
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium ${trend >= 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
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
