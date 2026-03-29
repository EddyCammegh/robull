'use client';

import { useMemo } from 'react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { Bet } from '@/types';

const OUTCOME_COLOURS = ['#FF4400', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#6B7280'];

interface PricePoint {
  probability: number;
  recorded_at: string;
}

interface OutcomeInfo {
  market_id: string;
  label: string;
}

interface Props {
  bets: Bet[];
  outcomes: OutcomeInfo[];
  priceHistory: Record<string, PricePoint[]>;
  outcomeIndexMap: Map<string, number>;
  selectedOutcome: string | null;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

const tooltipStyle: React.CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: 6,
  padding: '8px 12px',
  fontFamily: 'JetBrains Mono, monospace',
  maxWidth: 240,
};

function TimelineTooltip({ active, payload, betsAtTime }: any) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  // Probability lines
  const lines = payload.filter((p: any) => p.value != null && p.dataKey !== '_volume');

  // Find bets near this time point
  const t = point.time as number;
  const nearby: { agent: string; outcome: string }[] = betsAtTime?.(t) ?? [];

  return (
    <div style={tooltipStyle}>
      <p style={{ color: '#888', fontSize: 9, marginBottom: 3 }}>
        {new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </p>
      {lines.map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.stroke || p.color, flexShrink: 0 }} />
          <span style={{ color: '#ccc', flex: 1, fontSize: 10 }}>{p.dataKey}</span>
          <span style={{ color: '#fff', fontWeight: 600, fontSize: 10 }}>{Number(p.value).toFixed(1)}%</span>
        </div>
      ))}
      {nearby.length > 0 && (
        <div style={{ borderTop: '1px solid #333', marginTop: 4, paddingTop: 4 }}>
          <p style={{ color: '#888', fontSize: 9, marginBottom: 2 }}>
            {nearby.length} agent{nearby.length !== 1 ? 's' : ''} bet near this time
          </p>
          {nearby.slice(0, 3).map((b, i) => (
            <p key={i} style={{ color: '#aaa', fontSize: 9 }}>
              {b.agent} <span style={{ color: '#FF4400' }}>{'\u2192'}</span> {b.outcome}
            </p>
          ))}
          {nearby.length > 3 && (
            <p style={{ color: '#666', fontSize: 9 }}>+{nearby.length - 3} more</p>
          )}
        </div>
      )}
      {point._volume > 0 && (
        <p style={{ color: '#555', fontSize: 9, marginTop: 3 }}>
          {point._volume} bet{point._volume !== 1 ? 's' : ''} in this window
        </p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AgentConsensusTimeline({
  bets,
  outcomes,
  priceHistory,
  outcomeIndexMap,
  selectedOutcome,
}: Props) {
  if (bets.length < 2) return null;

  // Top 6 outcomes by bet activity
  const chartOutcomes = useMemo(() => {
    const betCounts: Record<string, number> = {};
    for (const b of bets) {
      betCounts[b.market_id] = (betCounts[b.market_id] || 0) + 1;
    }
    return outcomes
      .filter(o => betCounts[o.market_id])
      .sort((a, b) => (betCounts[b.market_id] || 0) - (betCounts[a.market_id] || 0))
      .slice(0, 6);
  }, [bets, outcomes]);

  // Outcome colour lookup by market_id
  const colourByMarket = useMemo(() => {
    const map: Record<string, string> = {};
    chartOutcomes.forEach((o, i) => {
      map[o.market_id] = OUTCOME_COLOURS[i] ?? OUTCOME_COLOURS[OUTCOME_COLOURS.length - 1];
    });
    return map;
  }, [chartOutcomes]);

  // Build probability line data from price history
  const { chartData, timeRange } = useMemo(() => {
    const timeMap = new Map<number, Record<string, any>>();

    for (const o of chartOutcomes) {
      const idx = outcomeIndexMap.get(o.market_id);
      const points = idx != null ? priceHistory[String(idx)] : undefined;
      if (!points) continue;
      for (const pt of points) {
        const t = new Date(pt.recorded_at).getTime();
        if (!timeMap.has(t)) timeMap.set(t, { time: t });
        timeMap.get(t)![o.label] = pt.probability * 100;
      }
    }

    const data = [...timeMap.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);

    const minT = data.length > 0 ? data[0].time : Date.now();
    const maxT = data.length > 0 ? data[data.length - 1].time : Date.now();
    return { chartData: data, timeRange: [minT, maxT] as [number, number] };
  }, [chartOutcomes, priceHistory, outcomeIndexMap]);

  // Build volume bars: bucket bets into time windows
  const volumeData = useMemo(() => {
    if (chartData.length < 2) return [];

    const [minT, maxT] = timeRange;
    const span = maxT - minT;
    const bucketCount = Math.min(20, Math.max(5, Math.round(span / (3600_000 * 2))));
    const bucketSize = span / bucketCount;

    if (bucketSize <= 0) return [];

    const buckets: { time: number; _volume: number }[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const start = minT + i * bucketSize;
      buckets.push({ time: start + bucketSize / 2, _volume: 0 });
    }

    for (const b of bets) {
      const t = new Date(b.created_at).getTime();
      const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((t - minT) / bucketSize)));
      buckets[idx]._volume++;
    }

    return buckets;
  }, [bets, chartData, timeRange]);

  // Merge volume into chart data for the composed chart
  const mergedData = useMemo(() => {
    if (chartData.length === 0) return [];

    // Start with chart data
    const all: Record<string, any>[] = chartData.map(d => ({ ...d, _volume: 0 }));

    // For each volume bucket, find nearest chart point and add volume
    for (const vb of volumeData) {
      if (vb._volume === 0) continue;
      let closest = all[0];
      let closestDist = Infinity;
      for (const pt of all) {
        const d = Math.abs(pt.time - vb.time);
        if (d < closestDist) {
          closestDist = d;
          closest = pt;
        }
      }
      if (closest) closest._volume += vb._volume;
    }

    return all;
  }, [chartData, volumeData]);

  // Sorted bets for tooltip lookup
  const sortedBets = useMemo(() => {
    return bets
      .map(b => ({
        time: new Date(b.created_at).getTime(),
        agent: b.agent_name ?? '?',
        outcome: (b as any).outcome_label ?? '?',
      }))
      .sort((a, b) => a.time - b.time);
  }, [bets]);

  // Function to find bets near a given time (within 10% of the total range)
  const betsAtTime = useMemo(() => {
    const [minT, maxT] = timeRange;
    const window = Math.max((maxT - minT) * 0.05, 30 * 60_000); // 5% of range or 30min minimum
    return (t: number) =>
      sortedBets.filter(b => Math.abs(b.time - t) <= window);
  }, [sortedBets, timeRange]);

  if (mergedData.length < 2) return null;

  // Determine which outcome is highlighted
  const selectedLabel = selectedOutcome
    ? chartOutcomes.find(o => o.market_id === selectedOutcome)?.label ?? null
    : null;

  const maxVolume = Math.max(1, ...mergedData.map(d => d._volume));

  return (
    <div className="mt-5">
      <p className="font-mono text-[10px] text-muted uppercase tracking-widest mb-2">
        Consensus timeline
      </p>

      {/* Probability lines */}
      <div style={{ width: '100%', height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={mergedData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid horizontal vertical={false} stroke="#1a1a1a" />
            <XAxis
              dataKey="time"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(t: number) =>
                new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              }
              tick={{ fontSize: 9, fill: '#444', fontFamily: 'JetBrains Mono, monospace' }}
              axisLine={{ stroke: '#222' }}
              tickLine={false}
              minTickGap={50}
            />
            <YAxis
              yAxisId="prob"
              orientation="right"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 9, fill: '#444', fontFamily: 'JetBrains Mono, monospace' }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <YAxis
              yAxisId="vol"
              orientation="left"
              domain={[0, maxVolume * 4]}
              hide
            />
            <Tooltip content={<TimelineTooltip betsAtTime={betsAtTime} />} />

            {/* Volume bars — subtle background layer */}
            <Bar
              yAxisId="vol"
              dataKey="_volume"
              fill="#FF4400"
              opacity={0.12}
              isAnimationActive={false}
              barSize={8}
            />

            {/* Probability lines */}
            {chartOutcomes.map((o, i) => {
              const colour = OUTCOME_COLOURS[i] ?? OUTCOME_COLOURS[OUTCOME_COLOURS.length - 1];
              const dimmed = selectedLabel !== null && o.label !== selectedLabel;
              return (
                <Line
                  key={o.market_id}
                  yAxisId="prob"
                  type="monotone"
                  dataKey={o.label}
                  stroke={colour}
                  strokeWidth={dimmed ? 1 : 2}
                  strokeOpacity={dimmed ? 0.2 : 1}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
        {chartOutcomes.map((o, i) => {
          const colour = OUTCOME_COLOURS[i] ?? OUTCOME_COLOURS[OUTCOME_COLOURS.length - 1];
          const dimmed = selectedLabel !== null && o.label !== selectedLabel;
          return (
            <span key={o.market_id} className="flex items-center gap-1" style={{ opacity: dimmed ? 0.3 : 1 }}>
              <span
                className="inline-block w-3 h-0.5 rounded flex-shrink-0"
                style={{ background: colour }}
              />
              <span className="font-mono text-[9px] text-muted">{o.label}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
