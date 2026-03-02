'use client';

interface UserTypeFilterProps {
  value: string;
  onChange: (userType: string) => void;
}

const userTypes = [
  { value: 'all', label: 'All Users', description: 'Everyone (visitors + accounts)' },
  { value: 'authenticated', label: 'Authenticated', description: 'Users with accounts' },
  { value: 'subscribers', label: 'Subscribers', description: 'Paying users' },
  { value: 'visitors', label: 'Visitors Only', description: 'Anonymous/guest users' },
];

export default function UserTypeFilter({ value, onChange }: UserTypeFilterProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-primary border border-zinc-300/50 text-foreground font-mono text-xs uppercase tracking-widest font-bold rounded-full px-4 py-2 hover:bg-zinc-200 transition-colors focus:ring-accent focus:border-accent cursor-pointer shadow-sm outline-none"
      title="Filter by user type"
    >
      {userTypes.map((type) => (
        <option key={type.value} value={type.value} title={type.description}>
          {type.label}
        </option>
      ))}
    </select>
  );
}
