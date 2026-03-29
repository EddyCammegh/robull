'use client';

import { useMemo, useState, useCallback } from 'react';
import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { Bet } from '@/types';

// ── Colour helpers ────────────────────────────────────────────────────────────

const OUTCOME_COLOURS = ['#FF4400', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#6B7280'];

/** Deterministic colour from agent name */
function agentColour(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffff;
  const hue = h % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

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
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function BetTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;

  // Find the scatter point in payload
  const scatter = payload.find((p: any) => p.payload?._agent);
  if (!scatter) {
    // Line-only hover — show the line values
    return (
      <div style={tooltipBox}>
        <p style={{ color: '#888', fontSize: 10, marginBottom: 2 }}>
          {payload[0]?.payload?.time
            ? new Date(payload[0].payload.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            : ''}
        </p>
        {payload
          .filter((p: any) => p.value != null && !p.dataKey.startsWith('_'))
          .map((p: any) => (
            <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.stroke || p.color, flexShrink: 0 }} />
              <span style={{ color: '#ccc', flex: 1, fontSize: 10 }}>{p.dataKey}</span>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: 10 }}>{Number(p.value).toFixed(1)}%</span>
            </div>
          ))}
      </div>
    );
  }

  const d = scatter.payload;
  return (
    <div style={tooltipBox}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: d._colour, flexShrink: 0 }} />
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 11 }}>{d._agent}</span>
      </div>
      <p style={{ color: '#ccc', fontSize: 10, marginBottom: 2 }}>
        Bet <span style={{ color: '#FF4400' }}>{d._outcome}</span> at {d._confidence}% confidence
      </p>
      <p style={{ color: '#888', fontSize: 10, marginBottom: 2 }}>
        {Number(d._wager).toLocaleString()} GNS
      </p>
      {d._reasoning && (
        <p style={{ color: '#666', fontSize: 9, maxWidth: 220, lineHeight: 1.4 }}>
          {d._reasoning}
        </p>
      )}
    </div>
  );
}

const tooltipBox: React.CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: 6,
  padding: '8px 12px',
  fontFamily: 'JetBrains Mono, monospace',
  maxWidth: 260,
};

// ── Custom scatter dot ────────────────────────────────────────────────────────

function BetDot(props: any) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload?._agent) return null;
  const r = Math.max(3, Math.min(7, 2 + (Number(payload._wager) || 0) / 200));
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={payload._colour}
      stroke="#111"
      strokeWidth={1}
      style={{ cursor: 'pointer' }}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AgentConsensusTimeline({ bets, outcomes, priceHistory, outcomeIndexMap }: Props) {
  if (bets.length < 2) return null;

  // Build a map of market_id → outcome label for colouring
  const outcomeColourMap = useMemo(() => {
    const map: Record<string, { colour: string; label: string }> = {};
    outcomes.forEach((o, i) => {
      map[o.market_id] = {
        colour: OUTCOME_COLOURS[i] ?? OUTCOME_COLOURS[OUTCOME_COLOURS.length - 1],
        label: o.label,
      };
    });
    return map;
  }, [outcomes]);

  // Top 6 outcomes by bet activity for the chart
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

  // Merge price history into chart data: [{ time, "Label1": pct, "Label2": pct, ... }]
  const chartData = useMemo(() => {
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
    return data;
  }, [chartOutcomes, priceHistory, outcomeIndexMap]);

  // Build scatter data from bets
  const scatterData = useMemo(() => {
    return bets
      .filter(b => b.confidence != null)
      .map(b => {
        const oc = outcomeColourMap[b.market_id];
        return {
          time: new Date(b.created_at).getTime(),
          _dot: b.confidence,
          _agent: b.agent_name ?? '?',
          _outcome: (b as any).outcome_label ?? oc?.label ?? '?',
          _confidence: b.confidence,
          _wager: Number(b.gns_wagered) || 0,
          _colour: agentColour(b.agent_name ?? '?'),
          _reasoning: (b.reasoning ?? '').slice(0, 120) + ((b.reasoning ?? '').length > 120 ? '...' : ''),
        };
      })
      .sort((a, b) => a.time - b.time);
  }, [bets, outcomeColourMap]);

  // Merge scatter points into chart data timeline
  const mergedData = useMemo(() => {
    if (chartData.length === 0) {
      // No price history — just use scatter points
      return scatterData.map(s => ({ ...s }));
    }

    // Combine: price history points + scatter points, sorted by time
    const all: Record<string, any>[] = [...chartData.map(d => ({ ...d }))];

    for (const s of scatterData) {
      // Find closest existing point or add new one
      let closest = all.reduce((best, pt) =>
        Math.abs(pt.time - s.time) < Math.abs(best.time - s.time) ? pt : best
      , all[0]);

      // If close enough (within 5 min), merge onto existing point
      if (closest && Math.abs(closest.time - s.time) < 5 * 60_000) {
        Object.assign(closest, s);
      } else {
        all.push({ ...s });
      }
    }

    all.sort((a, b) => a.time - b.time);
    return all;
  }, [chartData, scatterData]);

  if (mergedData.length < 2) return null;

  // Unique agents for legend
  const agentNames = useMemo(() => {
    const names = new Set<string>();
    for (const b of bets) if (b.agent_name) names.add(b.agent_name);
    return [...names].slice(0, 8);
  }, [bets]);

  return (
    <div className="mt-5">
      <p className="font-mono text-[10px] text-muted uppercase tracking-widest mb-2">
        Agent consensus timeline
      </p>

      <div style={{ width: '100%', height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={mergedData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid horizontal vertical={false} stroke="#222" />
            <XAxis
              dataKey="time"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              tick={{ fontSize: 9, fill: '#555', fontFamily: 'JetBrains Mono, monospace' }}
              axisLine={{ stroke: '#222' }}
              tickLine={false}
              minTickGap={50}
            />
            <YAxis
              orientation="right"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 9, fill: '#555', fontFamily: 'JetBrains Mono, monospace' }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip content={<BetTooltip />} />

            {/* Probability lines per outcome */}
            {chartOutcomes.map((o, i) => (
              <Line
                key={o.market_id}
                type="monotone"
                dataKey={o.label}
                stroke={OUTCOME_COLOURS[i] ?? OUTCOME_COLOURS[OUTCOME_COLOURS.length - 1]}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}

            {/* Agent bet dots */}
            <Scatter
              dataKey="_dot"
              shape={<BetDot />}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend: outcomes + agents */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {chartOutcomes.map((o, i) => (
          <span key={o.market_id} className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-0.5 rounded flex-shrink-0"
              style={{ background: OUTCOME_COLOURS[i] ?? OUTCOME_COLOURS[OUTCOME_COLOURS.length - 1] }}
            />
            <span className="font-mono text-[9px] text-muted">{o.label}</span>
          </span>
        ))}
        <span className="font-mono text-[9px] text-muted/40 mx-1">|</span>
        {agentNames.map(name => (
          <span key={name} className="flex items-center gap-1">
            <span
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: agentColour(name) }}
            />
            <span className="font-mono text-[9px] text-muted">{name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
