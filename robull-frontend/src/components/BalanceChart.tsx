'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  ComposedChart,
  Line,
  ReferenceLine,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://robull-production.up.railway.app';
const STARTING_BALANCE = 10000;

interface BalancePoint {
  timestamp: string;
  balance: number;
  event: 'bet' | 'win' | 'loss';
}

interface Props {
  agentId: string;
}

const EVENT_COLOURS: Record<string, string> = {
  bet:  '#FF4400',
  win:  '#22c55e',
  loss: '#ef4444',
};

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  const label =
    d._event === 'win' ? 'Market won'
    : d._event === 'loss' ? 'Market lost'
    : 'Bet placed';

  return (
    <div style={{
      background: '#1a1a1a',
      border: '1px solid #333',
      borderRadius: 6,
      padding: '6px 10px',
      fontFamily: 'JetBrains Mono, monospace',
    }}>
      <p style={{ color: '#888', fontSize: 9, marginBottom: 2 }}>
        {new Date(d._ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </p>
      <p style={{ color: '#fff', fontSize: 11, fontWeight: 600 }}>
        {d.balance.toLocaleString()} GNS
      </p>
      <p style={{ color: EVENT_COLOURS[d._event] ?? '#888', fontSize: 10 }}>
        {label}
      </p>
    </div>
  );
}

function DotShape(props: any) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload?._event) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3}
      fill={EVENT_COLOURS[payload._event] ?? '#FF4400'}
      stroke="#111"
      strokeWidth={1}
    />
  );
}

export default function BalanceChart({ agentId }: Props) {
  const [points, setPoints] = useState<BalancePoint[] | null>(null);

  useEffect(() => {
    fetch(`${API}/v1/agents/${agentId}/balance-history`)
      .then(r => r.ok ? r.json() : [])
      .then(setPoints)
      .catch(() => setPoints([]));
  }, [agentId]);

  const chartData = useMemo(() => {
    if (!points || points.length < 2) return null;

    // Prepend starting balance
    const firstTs = new Date(points[0].timestamp).getTime();
    const start = {
      time: firstTs - 60_000,
      balance: STARTING_BALANCE,
      _dot: null as number | null,
      _event: null as string | null,
      _ts: new Date(firstTs - 60_000).toISOString(),
    };

    const data = [start, ...points.map(p => ({
      time: new Date(p.timestamp).getTime(),
      balance: p.balance,
      _dot: p.balance,
      _event: p.event,
      _ts: p.timestamp,
    }))];

    return data;
  }, [points]);

  if (!chartData) return null;

  const balances = chartData.map(d => d.balance);
  const minBal = Math.min(...balances);
  const maxBal = Math.max(...balances);
  const padding = Math.max(500, (maxBal - minBal) * 0.15);
  const yMin = Math.floor((minBal - padding) / 500) * 500;
  const yMax = Math.ceil((maxBal + padding) / 500) * 500;

  const currentBalance = chartData[chartData.length - 1].balance;
  const isUp = currentBalance >= STARTING_BALANCE;

  return (
    <div className="p-6 border-b border-border">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-mono text-[10px] text-muted uppercase tracking-widest">Balance history</h3>
        <span className={`font-mono text-[10px] font-bold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
          {isUp ? '+' : ''}{(currentBalance - STARTING_BALANCE).toLocaleString()} GNS
        </span>
      </div>
      <div style={{ width: '100%', height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
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
              orientation="right"
              domain={[yMin, yMax]}
              tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`}
              tick={{ fontSize: 9, fill: '#444', fontFamily: 'JetBrains Mono, monospace' }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip content={<ChartTooltip />} />

            {/* Starting balance reference */}
            <ReferenceLine
              y={STARTING_BALANCE}
              stroke="#333"
              strokeDasharray="4 4"
              label={{ value: '10k', position: 'left', fill: '#444', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}
            />

            {/* Balance line */}
            <Line
              type="monotone"
              dataKey="balance"
              stroke={isUp ? '#22c55e' : '#ef4444'}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />

            {/* Event dots */}
            <Scatter
              dataKey="_dot"
              shape={<DotShape />}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
