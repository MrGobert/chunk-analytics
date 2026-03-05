interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}

export default function ChartCard({ title, subtitle, children, className = '' }: ChartCardProps) {
  return (
    <div className={`card-animate rounded-[1.5rem] bg-primary/60 backdrop-blur-xl border border-white/5 p-6 sm:p-8 shadow-lg transition-all duration-300 hover:border-white/10 ${className}`}>
      <div className="mb-6 sm:mb-8 border-b border-white/5 pb-4">
        <h3 className="text-xl sm:text-2xl font-bold font-sans tracking-tight text-foreground">{title}</h3>
        {subtitle && <p className="text-sm font-mono text-zinc-400 mt-2 uppercase tracking-wide">{subtitle}</p>}
      </div>
      <div className="h-[250px] sm:h-[300px]">{children}</div>
    </div>
  );
}
