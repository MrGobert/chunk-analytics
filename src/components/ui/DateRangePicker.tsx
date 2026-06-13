'use client';

interface DateRangePickerProps {
  value: string;
  onChange: (range: string) => void;
}

const ranges = [
  { label: 'Today', value: '1d' },
  { label: '7 Days', value: '7d' },
  { label: '30 Days', value: '30d' },
  { label: '90 Days', value: '90d' },
  { label: '12 Months', value: '365d' },
];

export default function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-card border border-line p-1 shadow-card">
      {ranges.map((range) => (
        <button
          key={range.value}
          onClick={() => onChange(range.value)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-all duration-300 ${
            value === range.value
              ? 'bg-ember-deep text-[#FFF8F2]'
              : 'text-ink-soft hover:text-ink hover:bg-paper-deep'
          }`}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
