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
    // Flat line fallback
    return [currentValue, currentValue];
  }, [data, currentValue, hasHistory]);

  // Map points to SVG coordinates
  // Y: 0-1 probability → SVG y (top=high, bottom=low), with 2px padding
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
    <div className="relative w-full" style={{ height }}>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full h-full"
        style={{ display: 'block' }}
      >
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {!hasHistory && (
        <span className="absolute bottom-0 right-0 font-mono text-[8px] text-muted opacity-60 leading-none">
          {pct}%
        </span>
      )}
    </div>
  );
}
