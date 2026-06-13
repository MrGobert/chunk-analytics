interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  /** Optional content rendered on the right side of the header (legend, toggle…). */
  action?: React.ReactNode;
  /** Override the default chart body height. */
  bodyClassName?: string;
}

export default function ChartCard({
  title,
  subtitle,
  children,
  className = '',
  action,
  bodyClassName = 'h-[250px] sm:h-[300px]',
}: ChartCardProps) {
  return (
    <div className={`card-animate card-surface p-6 sm:p-8 ${className}`}>
      <div className="mb-6 sm:mb-8 border-b border-line pb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-xl sm:text-2xl text-ink">{title}</h3>
          {subtitle && <p className="text-sm font-mono text-ink-faint mt-2">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}
