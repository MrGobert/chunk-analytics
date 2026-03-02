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
        <CartesianGrid strokeDasharray="3 3" stroke="#d4d4d8" />
        <XAxis
          dataKey={xKey}
          stroke="#71717a"
          fontSize={12}
          fontFamily="var(--font-mono)"
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
        {showLegend && <Legend wrapperStyle={{ fontFamily: 'var(--font-sans)', fontSize: '12px' }} />}
        {lines.map((line) => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            stroke={line.color}
            strokeWidth={3}
            dot={false}
            name={line.name || line.key}
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
