'use client';

import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

interface DataPoint {
  time: number; // epoch ms
  value: number; // 0-1
}

interface SparklineChartProps {
  /** Historical data points. If empty/undefined, renders flat line at currentValue. */
  data?: DataPoint[];
  /** Current probability (0-1). Used as flat line if no history. */
  currentValue: number;
  /** Chart height in pixels */
  height?: number;
  /** Line color */
  color?: string;
  /** Show X/Y axes */
  showAxes?: boolean;
  /** Outcome label shown in tooltip */
  label?: string;
}

export default function SparklineChart({
  data,
  currentValue,
  height = 50,
  color = '#FF4400',
  showAxes = false,
  label,
}: SparklineChartProps) {
  const chartData = useMemo(() => {
    if (data && data.length > 1) {
      return data.map((d) => ({ t: d.time, v: d.value }));
    }
    // Flat line: two points at current value
    const now = Date.now();
    return [
      { t: now - 3600_000, v: currentValue },
      { t: now, v: currentValue },
    ];
  }, [data, currentValue]);

  const hasHistory = data && data.length > 1;
  const pct = (currentValue * 100).toFixed(0);

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
          {showAxes && (
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              tick={false}
              axisLine={{ stroke: '#222' }}
              tickLine={false}
              height={1}
            />
          )}
          {showAxes && (
            <YAxis
              domain={[0, 1]}
              tick={{ fontSize: 9, fill: '#555' }}
              axisLine={false}
              tickLine={false}
              width={28}
              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
            />
          )}
          {hasHistory && (
            <Tooltip
              contentStyle={{ background: '#161616', border: '1px solid #222', borderRadius: 4, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
              labelFormatter={(t: any) => new Date(Number(t)).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              formatter={(v: any) => [`${(Number(v) * 100).toFixed(1)}%`, label ?? 'Prob']}
            />
          )}
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {!hasHistory && (
        <span className="absolute bottom-0 right-0 font-mono text-[8px] text-muted opacity-60">
          {pct}% &middot; history building
        </span>
      )}
    </div>
  );
}
