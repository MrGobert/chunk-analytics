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
      className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-violet-500 focus:border-violet-500 cursor-pointer"
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
