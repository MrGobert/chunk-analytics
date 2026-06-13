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
import { chart } from '@/lib/chartTheme';

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
        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
        <XAxis
          dataKey={xKey}
          stroke={chart.axis}
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
        <YAxis stroke={chart.axis} fontSize={12} fontFamily="var(--font-mono)" tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={chart.tooltip}
          labelStyle={chart.tooltipLabelStyle}
          itemStyle={chart.tooltipItemStyle}
        />
        {showLegend && (
          <Legend
            wrapperStyle={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: chart.axis }}
          />
        )}
        {lines.map((line) => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            stroke={line.color}
            strokeWidth={2.5}
            dot={false}
            name={line.name || line.key}
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
