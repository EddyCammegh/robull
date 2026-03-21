'use client';

import { useMemo } from 'react';

interface DataPoint {
  time: number;
  value: number; // 0-1
}

interface SparklineChartProps {
  data?: DataPoint[];
  currentValue: number;
  height?: number;
  color?: string;
  showAxes?: boolean;
  label?: string;
}

export default function SparklineChart({
  data,
  currentValue,
  height = 50,
  color = '#FF4400',
}: SparklineChartProps) {
  const hasHistory = data && data.length > 1;

  const points = useMemo(() => {
    if (hasHistory) {
      return data!.map((d) => d.value);
    }
    return [currentValue, currentValue];
  }, [data, currentValue, hasHistory]);

  const padY = 2;
  const innerH = height - padY * 2;

  const pathD = useMemo(() => {
    if (points.length === 0) return '';
    const step = 100 / Math.max(points.length - 1, 1);
    return points
      .map((v, i) => {
        const x = i * step;
        const y = padY + innerH * (1 - Math.min(Math.max(v, 0), 1));
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [points, innerH, padY]);

  const pct = (currentValue * 100).toFixed(0);

  return (
    <div
      style={{ height, width: '100%', background: '#111', borderRadius: 3, position: 'relative' }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {!hasHistory && (
        <span
          style={{
            position: 'absolute',
            bottom: 1,
            right: 3,
            fontSize: 8,
            fontFamily: 'monospace',
            color: '#555',
            lineHeight: 1,
          }}
        >
          {pct}%
        </span>
      )}
    </div>
  );
}
