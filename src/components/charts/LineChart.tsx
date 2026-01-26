'use client';

import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface LineChartProps {
  data: { [key: string]: string | number | boolean | null | undefined }[];
  xKey: string;
  lines: { key: string; color: string; name?: string }[];
  showLegend?: boolean;
}

export default function LineChart({ data, xKey, lines, showLegend = false }: LineChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RechartsLineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis
          dataKey={xKey}
          stroke="#71717a"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => {
            if (typeof value === 'string' && value.includes('-')) {
              const parts = value.split('-');
              return `${parts[1]}/${parts[2]}`;
            }
            return value;
          }}
        />
        <YAxis stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#18181b',
            border: '1px solid #27272a',
            borderRadius: '8px',
            color: '#fff',
          }}
          labelStyle={{ color: '#a1a1aa' }}
        />
        {showLegend && <Legend />}
        {lines.map((line) => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            stroke={line.color}
            strokeWidth={2}
            dot={false}
            name={line.name || line.key}
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
