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
  color = '#8b5cf6',
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
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
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
          }}
          labelStyle={{ color: '#a1a1aa' }}
          itemStyle={{ color: '#fff' }}
        />
        <Area
          type="monotone"
          dataKey={yKey}
          stroke={color}
          strokeWidth={2}
          fill={gradient ? `url(#${gradientId})` : color}
          fillOpacity={gradient ? 1 : 0.3}
        />
      </RechartsAreaChart>
    </ResponsiveContainer>
  );
}
