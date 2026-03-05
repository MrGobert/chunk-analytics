'use client';

import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface BarChartProps {
  data: { [key: string]: string | number | boolean | null | undefined }[];
  xKey: string;
  yKey: string;
  color?: string;
  colors?: string[];
  horizontal?: boolean;
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

export default function BarChart({
  data,
  xKey,
  yKey,
  color = '#10b981',
  colors,
  horizontal = false,
}: BarChartProps) {
  const chartColors = colors || [color];

  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart
          data={data}
          layout="vertical"
          margin={{ top: 5, right: 20, left: 80, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
          <XAxis type="number" stroke="#71717a" fontSize={12} fontFamily="var(--font-mono)" tickLine={false} axisLine={false} />
          <YAxis
            type="category"
            dataKey={xKey}
            stroke="#71717a"
            fontSize={12}
            fontFamily="var(--font-mono)"
            tickLine={false}
            axisLine={false}
            width={70}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(24, 24, 27, 0.8)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '12px',
              fontFamily: 'var(--font-mono)',
              backdropFilter: 'blur(8px)',
            }}
            labelStyle={{ color: '#a1a1aa', fontWeight: 'bold' }}
            itemStyle={{ color: '#fafafa' }}
          />
          <Bar dataKey={yKey} radius={[0, 4, 4, 0]}>
            {data.map((_, index) => (
              <Cell
                key={`cell-${index}`}
                fill={chartColors[index % chartColors.length] || defaultColors[index % defaultColors.length]}
              />
            ))}
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RechartsBarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis
          dataKey={xKey}
          stroke="#71717a"
          fontSize={12}
          fontFamily="var(--font-mono)"
          tickLine={false}
          axisLine={false}
        />
        <YAxis stroke="#71717a" fontSize={12} fontFamily="var(--font-mono)" tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'rgba(24, 24, 27, 0.8)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px',
            fontFamily: 'var(--font-mono)',
            backdropFilter: 'blur(8px)',
          }}
          labelStyle={{ color: '#a1a1aa', fontWeight: 'bold' }}
          itemStyle={{ color: '#fafafa' }}
        />
        <Bar dataKey={yKey} radius={[4, 4, 0, 0]}>
          {data.map((_, index) => (
            <Cell
              key={`cell-${index}`}
              fill={chartColors[index % chartColors.length] || defaultColors[index % defaultColors.length]}
            />
          ))}
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
