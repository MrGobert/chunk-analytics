'use client';

import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface PieChartProps {
  data: { name: string; value: number }[];
  colors?: string[];
  showLegend?: boolean;
  innerRadius?: number;
  outerRadius?: number;
}

const defaultColors = [
  '#8b5cf6',
  '#6366f1',
  '#3b82f6',
  '#0ea5e9',
  '#14b8a6',
  '#22c55e',
  '#eab308',
  '#f97316',
  '#ef4444',
  '#ec4899',
];

export default function PieChart({
  data,
  colors = defaultColors,
  showLegend = true,
  innerRadius = 60,
  outerRadius = 100,
}: PieChartProps) {
  // Filter out zero-value entries to prevent Recharts rendering issues
  const filteredData = data.filter((d) => d.value > 0);

  if (filteredData.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-sm">
        No data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RechartsPieChart>
        <Pie
          data={filteredData}
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          paddingAngle={2}
          dataKey="value"
          nameKey="name"
        >
          {filteredData.map((_, index) => (
            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: '#E8E4DD',
            border: '1px solid #d4d4d8',
            borderRadius: '0',
            fontFamily: 'var(--font-mono)',
          }}
          labelStyle={{ color: '#71717a', fontWeight: 'bold' }}
          itemStyle={{ color: '#111111' }}
        />
        {showLegend && (
          <Legend
            layout="vertical"
            align="right"
            verticalAlign="middle"
            formatter={(value) => <span className="text-foreground tracking-tight font-sans text-sm">{value}</span>}
          />
        )}
      </RechartsPieChart>
    </ResponsiveContainer>
  );
}
