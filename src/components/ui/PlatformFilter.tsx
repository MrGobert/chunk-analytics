'use client';

interface PlatformFilterProps {
  value: string;
  onChange: (platform: string) => void;
}

const platforms = [
  { value: 'all', label: 'All Platforms' },
  { value: 'iOS', label: 'iOS' },
  { value: 'iPadOS', label: 'iPadOS' },
  { value: 'macOS', label: 'macOS' },
  { value: 'visionOS', label: 'visionOS' },
  { value: 'web', label: 'Web' },
];

export default function PlatformFilter({ value, onChange }: PlatformFilterProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-primary border border-zinc-300/50 text-foreground font-mono text-xs uppercase tracking-widest font-bold rounded-full px-4 py-2 hover:bg-zinc-200 transition-colors focus:ring-accent focus:border-accent cursor-pointer shadow-sm outline-none"
    >
      {platforms.map((platform) => (
        <option key={platform.value} value={platform.value}>
          {platform.label}
        </option>
      ))}
    </select>
  );
}
