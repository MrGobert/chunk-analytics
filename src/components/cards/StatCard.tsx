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
  /** When true, a falling trend is "good" (e.g. churn rate, failure rate). */
  invertTrend?: boolean;
}

export default function StatCard({
  title,
  value,
  trend,
  format = 'number',
  subtitle,
  icon,
  prefix = '',
  suffix = '',
  invertTrend = false,
}: StatCardProps) {
  const getFormattedValue = () => {
    if (format === 'text' || typeof value === 'string') return value;
    // Guard against undefined/NaN (e.g. a backend field missing on a stale payload)
    // so a KPI card degrades to 0 instead of crashing on .toFixed().
    const num = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    if (format === 'currency') return '$' + num.toFixed(2);
    if (format === 'percentage') return formatPercentage(num);
    if (format === 'ratio') return num.toFixed(2);
    if (format === 'decimal') return num.toFixed(1);
    return formatNumber(num);
  };

  const formattedValue = getFormattedValue();
  const isNewTrend = trend === null;
  const trendUp = trend !== undefined && trend !== null && trend >= 0;
  // Direction the user cares about: up is good unless inverted.
  const trendIsGood = invertTrend ? !trendUp : trendUp;
  const trendIcon = trendUp ? '↑' : '↓';

  return (
    <div className="card-animate card-surface card-hover p-5 sm:p-7 group">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold tracking-tight text-ink-soft">{title}</span>
        {icon && <div className="text-ink-faint hidden sm:block">{icon}</div>}
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-3xl sm:text-4xl font-medium font-mono text-ink tracking-tight tabular-nums">
          {typeof value === 'number' && Number.isFinite(value) && format !== 'text' ? (
            <AnimatedNumber value={value} format={format} prefix={prefix} suffix={suffix} />
          ) : (
            formattedValue
          )}
        </span>
        <div className="flex flex-col justify-end pb-1">
          {isNewTrend && (
            <span className="sticker text-[0.7rem] !py-0.5 !px-2.5 bg-butter-tint border-butter/50 text-ink-soft -rotate-2">
              New
            </span>
          )}
          {trend !== undefined && trend !== null && (
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium border ${
                trendIsGood
                  ? 'bg-sage-tint text-sage-deep border-sage/30'
                  : 'bg-ember-tint text-ember-deep border-ember/30'
              }`}
            >
              {trendIcon} {Math.abs(trend).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
      {subtitle && (
        <div className="mt-2 text-xs font-mono text-ink-faint tracking-tight">{subtitle}</div>
      )}
    </div>
  );
}
