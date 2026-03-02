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
  color = '#8b5cf6',
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
          <CartesianGrid strokeDasharray="3 3" stroke="#d4d4d8" horizontal={false} />
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
              backgroundColor: '#E8E4DD',
              border: '1px solid #d4d4d8',
              borderRadius: '0',
              fontFamily: 'var(--font-mono)',
            }}
            labelStyle={{ color: '#71717a', fontWeight: 'bold' }}
            itemStyle={{ color: '#111111' }}
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
        <CartesianGrid strokeDasharray="3 3" stroke="#d4d4d8" vertical={false} />
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
            backgroundColor: '#E8E4DD',
            border: '1px solid #d4d4d8',
            borderRadius: '0',
            fontFamily: 'var(--font-mono)',
          }}
          labelStyle={{ color: '#71717a', fontWeight: 'bold' }}
          itemStyle={{ color: '#111111' }}
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
