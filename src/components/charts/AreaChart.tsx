'use client';

import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface AreaChartProps {
  data: { [key: string]: string | number | boolean | null | undefined }[];
  xKey: string;
  yKey: string;
  color?: string;
  gradient?: boolean;
}

export default function AreaChart({
  data,
  xKey,
  yKey,
  color = '#E63B2E',
  gradient = true,
}: AreaChartProps) {
  const gradientId = `gradient-${yKey}`;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RechartsAreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <defs>
          {gradient && (
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          )}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#d4d4d8" vertical={false} />
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
        <Area
          type="monotone"
          dataKey={yKey}
          stroke={color}
          strokeWidth={3}
          fill={gradient ? `url(#${gradientId})` : color}
          fillOpacity={gradient ? 1 : 0.3}
        />
      </RechartsAreaChart>
    </ResponsiveContainer>
  );
}
