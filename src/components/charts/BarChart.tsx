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
import { chart } from '@/lib/chartTheme';

interface BarChartProps {
  data: { [key: string]: string | number | boolean | null | undefined }[];
  xKey: string;
  yKey: string;
  color?: string;
  colors?: string[];
  horizontal?: boolean;
}

const defaultColors: string[] = [...chart.series];

export default function BarChart({
  data,
  xKey,
  yKey,
  color = chart.series[0],
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
          <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
          <XAxis type="number" stroke={chart.axis} fontSize={12} fontFamily="var(--font-mono)" tickLine={false} axisLine={false} />
          <YAxis
            type="category"
            dataKey={xKey}
            stroke={chart.axis}
            fontSize={12}
            fontFamily="var(--font-mono)"
            tickLine={false}
            axisLine={false}
            width={70}
          />
          <Tooltip
            cursor={{ fill: chart.cursor }}
            contentStyle={chart.tooltip}
            labelStyle={chart.tooltipLabelStyle}
            itemStyle={chart.tooltipItemStyle}
          />
          <Bar dataKey={yKey} radius={[0, 6, 6, 0]}>
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
        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
        <XAxis
          dataKey={xKey}
          stroke={chart.axis}
          fontSize={12}
          fontFamily="var(--font-mono)"
          tickLine={false}
          axisLine={false}
        />
        <YAxis stroke={chart.axis} fontSize={12} fontFamily="var(--font-mono)" tickLine={false} axisLine={false} />
        <Tooltip
          cursor={{ fill: chart.cursor }}
          contentStyle={chart.tooltip}
          labelStyle={chart.tooltipLabelStyle}
          itemStyle={chart.tooltipItemStyle}
        />
        <Bar dataKey={yKey} radius={[6, 6, 0, 0]}>
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
