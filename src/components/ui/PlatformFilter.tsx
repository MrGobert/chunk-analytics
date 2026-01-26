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
      className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-violet-500 focus:border-violet-500 cursor-pointer"
    >
      {platforms.map((platform) => (
        <option key={platform.value} value={platform.value}>
          {platform.label}
        </option>
      ))}
    </select>
  );
}
