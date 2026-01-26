'use client';

import { useState } from 'react';

interface DateRangePickerProps {
  value: string;
  onChange: (range: string) => void;
}

const ranges = [
  { label: '7 Days', value: '7d' },
  { label: '30 Days', value: '30d' },
  { label: '90 Days', value: '90d' },
];

export default function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-zinc-800 p-1">
      {ranges.map((range) => (
        <button
          key={range.value}
          onClick={() => onChange(range.value)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            value === range.value
              ? 'bg-violet-600 text-white'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-700'
          }`}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
