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
      className="input-paper text-ink font-semibold text-xs rounded-full px-4 py-2 hover:border-ink/30 transition-colors cursor-pointer shadow-card outline-none"
    >
      {platforms.map((platform) => (
        <option key={platform.value} value={platform.value}>
          {platform.label}
        </option>
      ))}
    </select>
  );
}
