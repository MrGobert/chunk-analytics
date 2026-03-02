'use client';

import { useState } from 'react';

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
    <div className="flex items-center gap-1 rounded-[1.5rem] bg-primary border border-zinc-300/50 p-1 shadow-sm">
      {ranges.map((range) => (
        <button
          key={range.value}
          onClick={() => onChange(range.value)}
          className={`px-3 py-1.5 text-xs uppercase tracking-widest font-mono font-bold rounded-full transition-all duration-300 ${value === range.value
              ? 'bg-accent text-white shadow-sm'
              : 'text-zinc-500 hover:text-foreground hover:bg-zinc-200'
            }`}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
