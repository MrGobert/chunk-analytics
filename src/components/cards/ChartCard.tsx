interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}

export default function ChartCard({ title, subtitle, children, className = '' }: ChartCardProps) {
  return (
    <div className={`rounded-xl bg-zinc-900 border border-zinc-800 p-4 sm:p-6 ${className}`}>
      <div className="mb-3 sm:mb-4">
        <h3 className="text-base sm:text-lg font-semibold text-white">{title}</h3>
        {subtitle && <p className="text-xs sm:text-sm text-zinc-400 mt-1">{subtitle}</p>}
      </div>
      <div className="h-[250px] sm:h-[300px]">{children}</div>
    </div>
  );
}
