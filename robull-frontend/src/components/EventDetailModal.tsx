'use client';

import { useEffect, useState, useMemo } from 'react';
import clsx from 'clsx';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import PolymarketButton from './PolymarketButton';
import CountdownTimer from './CountdownTimer';
import BetThread from './BetThread';
import AgentConsensusTimeline from './AgentConsensusTimeline';
import { api } from '@/lib/api';
import { getChartType } from '@/lib/chartDecision';
import type { Bet, MarketCategory } from '@/types';

const CATEGORY_CLASS: Record<MarketCategory, string> = {
  MACRO:         'cat-MACRO',
  POLITICS:      'cat-POLITICS',
  CRYPTO:        'cat-CRYPTO',
  SPORTS:        'cat-SPORTS',
  'AI/TECH':     'cat-AITECH',
  ENTERTAINMENT: 'cat-ENTERTAINMENT',
  OTHER:         'cat-OTHER',
};

interface EventOutcome {
  market_id: string;
  label: string;
  probability: number;
  polymarket_probability: number;
  divergence: number;
  volume: number;
  closes_at?: string | null;
  active: boolean;
  passed: boolean;
}

interface EventData {
  id: string;
  title: string;
  category: string;
  polymarket_url: string;
  volume: number;
  closes_at: string | null;
  resolved: boolean;
  event_type: string;
  active_agent_count: number;
  active_outcomes: number;
  lmsr_b: number;
  outcomes: EventOutcome[];
  bets: Bet[];
}

interface EventDetailModalProps {
  event: EventData;
  loading: boolean;
  onClose: () => void;
}

const BAR_TOP_N = 8;
const OUTCOME_COLOURS = ['#FF4400', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#6B7280'];

type TimeRange = '1H' | '6H' | '1D' | '1W' | '1M' | 'ALL';
const TIME_RANGES: { key: TimeRange; label: string; hours: number }[] = [
  { key: '1H',  label: '1H',  hours: 1 },
  { key: '6H',  label: '6H',  hours: 6 },
  { key: '1D',  label: '1D',  hours: 24 },
  { key: '1W',  label: '1W',  hours: 168 },
  { key: '1M',  label: '1M',  hours: 720 },
  { key: 'ALL', label: 'ALL', hours: 720 },
];

type SortMode = 'recent' | 'confidence' | 'wager';

function CustomTooltip({ active, payload, label, outcomeLabels }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
      <p style={{ color: '#888', marginBottom: 4, fontSize: 10 }}>
        {new Date(label).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </p>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.stroke, flexShrink: 0 }} />
          <span style={{ color: '#ccc', flex: 1 }}>{p.dataKey}</span>
          <span style={{ color: '#fff', fontWeight: 600 }}>{typeof p.value === 'number' ? p.value.toFixed(1) : '\u2014'}%</span>
        </div>
      ))}
    </div>
  );
}

export default function EventDetailModal({ event, loading, onClose }: EventDetailModalProps) {
  const category = event.category as MarketCategory;
  const bets = event.bets ?? [];
  const isIndependent = event.event_type === 'independent' || event.event_type === 'sports_props';

  const [priceHistory, setPriceHistory] = useState<Record<string, { probability: number; recorded_at: string }[]>>({});
  const [timeRange, setTimeRange] = useState<TimeRange>('1W');
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('recent');

  useEffect(() => {
    if (event?.id) {
      api.priceHistory.get({ event_id: event.id, hours: 720 }).then((data) => {
        setPriceHistory(data);
      }).catch(() => {});
    }
  }, [event?.id]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Build map from market_id to original outcome_index
  const outcomeIndexMap = new Map<string, number>();
  event.outcomes.forEach((o, i) => outcomeIndexMap.set(o.market_id, i));

  // Count bets per outcome market_id
  const betCountByMarket = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const b of bets) {
      counts[b.market_id] = (counts[b.market_id] || 0) + 1;
    }
    return counts;
  }, [bets]);

  // Total volume wagered
  const totalWagered = useMemo(
    () => bets.reduce((sum, b) => sum + (b.gns_wagered || 0), 0),
    [bets],
  );

  const sorted = [...event.outcomes].sort((a, b) => {
    if (a.passed !== b.passed) return a.passed ? 1 : 0;
    return b.probability - a.probability;
  });

  const maxProb = sorted.length > 0 ? sorted[0].probability : 1;
  const activeOutcomes = sorted.filter(o => !o.passed);
  const chartOutcomes = activeOutcomes.slice(0, 6);
  const showTopN = activeOutcomes.length > BAR_TOP_N;
  const barOutcomes = showTopN ? sorted.slice(0, BAR_TOP_N) : sorted;
  const hiddenBarCount = showTopN ? sorted.length - BAR_TOP_N : 0;

  // Filter and sort bets
  const filteredBets = useMemo(() => {
    let filtered = selectedOutcome
      ? bets.filter(b => b.market_id === selectedOutcome)
      : bets;

    if (sortMode === 'confidence') {
      filtered = [...filtered].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    } else if (sortMode === 'wager') {
      filtered = [...filtered].sort((a, b) => (b.gns_wagered || 0) - (a.gns_wagered || 0));
    }
    // 'recent' uses the default order (already sorted by created_at DESC from API)
    return filtered;
  }, [bets, selectedOutcome, sortMode]);

  const selectedOutcomeLabel = selectedOutcome
    ? event.outcomes.find(o => o.market_id === selectedOutcome)?.label
    : null;

  // Determine chart type
  const chartDecision = useMemo(
    () => getChartType(event, Object.keys(priceHistory).length > 0 ? priceHistory : null),
    [event, priceHistory],
  );

  // Build merged chart data: array of { time, "label1": pct, "label2": pct, ... }
  const { chartData, hasHistory } = useMemo(() => {
    const timeMap = new Map<number, Record<string, number>>();

    for (const o of chartOutcomes) {
      const idx = outcomeIndexMap.get(o.market_id);
      const raw = idx != null ? priceHistory[String(idx)] : undefined;
      if (!raw) continue;
      for (const pt of raw) {
        const t = new Date(pt.recorded_at).getTime();
        if (!timeMap.has(t)) timeMap.set(t, {});
        timeMap.get(t)![o.label] = pt.probability * 100;
      }
    }

    const rangeHours = TIME_RANGES.find(r => r.key === timeRange)?.hours ?? 168;
    const cutoff = Date.now() - rangeHours * 3600_000;
    const entries = [...timeMap.entries()]
      .filter(([t]) => t >= cutoff)
      .sort(([a], [b]) => a - b);

    const hasHist = entries.length >= 3;

    if (!hasHist) {
      const now = Date.now();
      const flat = [
        { time: now - 3600_000 } as Record<string, any>,
        { time: now } as Record<string, any>,
      ];
      for (const o of chartOutcomes) {
        flat[0][o.label] = o.probability * 100;
        flat[1][o.label] = o.probability * 100;
      }
      return { chartData: flat, hasHistory: false };
    }

    const data = entries.map(([t, vals]) => ({ time: t, ...vals }));
    return { chartData: data, hasHistory: true };
  }, [priceHistory, chartOutcomes, outcomeIndexMap, timeRange]);

  function handleBarClick(marketId: string) {
    setSelectedOutcome(prev => prev === marketId ? null : marketId);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4 pt-16" onClick={onClose}>
      <div className="w-full max-w-3xl card p-0 animate-slideUp" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className={clsx('rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase', CATEGORY_CLASS[category])}>
                  {category}
                </span>
                <span className={clsx(
                  'rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold',
                  isIndependent ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-green-500/10 border-green-500/30 text-green-400'
                )}>
                  {event.event_type === 'sports_props' ? 'GAME PROPS' : isIndependent ? 'INDEPENDENT' : 'PICK ONE'}
                </span>
                <CountdownTimer closesAt={event.closes_at} resolved={event.resolved} activeOutcomes={event.active_outcomes} />
              </div>
              <h2 className="font-heading text-2xl text-white leading-tight">{event.title}</h2>
              <div className="flex flex-wrap items-center gap-3 mt-1.5">
                {event.active_agent_count > 0 && (
                  <span className="font-mono text-[10px] text-muted">
                    {event.active_agent_count} agent{event.active_agent_count !== 1 ? 's' : ''} betting
                  </span>
                )}
                {totalWagered > 0 && (
                  <span className="font-mono text-[10px] text-muted">
                    {totalWagered.toLocaleString()} GNS wagered
                  </span>
                )}
                {bets.length > 0 && (
                  <span className="font-mono text-[10px] text-muted">
                    {bets.length} bet{bets.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-muted hover:text-white hover:bg-subtle/50 text-lg font-mono transition-colors">x</button>
          </div>

          {/* ── Probability chart (skipped entirely for independent events) ── */}
          {!isIndependent && (<div className="mt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-mono text-[10px] text-muted uppercase tracking-widest">Probability trends</p>
              {chartDecision.type === 'line' && (
                <div className="flex gap-1">
                  {TIME_RANGES.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => setTimeRange(r.key)}
                      className={clsx(
                        'rounded-full px-2 py-0.5 font-mono text-[9px] font-bold transition-colors',
                        timeRange === r.key
                          ? 'bg-accent text-white'
                          : 'bg-subtle/50 text-muted hover:text-white'
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* LINE chart */}
            {chartDecision.type === 'line' && (
              <>
                <div style={{ width: '100%', height: 200, position: 'relative' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <CartesianGrid horizontal={true} vertical={false} stroke="#222222" />
                      <XAxis
                        dataKey="time"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        tick={{ fontSize: 10, fill: '#555555', fontFamily: 'JetBrains Mono, monospace' }}
                        axisLine={{ stroke: '#222' }}
                        tickLine={false}
                        minTickGap={40}
                      />
                      <YAxis
                        orientation="right"
                        domain={[0, 100]}
                        ticks={[0, 25, 50, 75, 100]}
                        tickFormatter={(v: number) => `${v}%`}
                        tick={{ fontSize: 10, fill: '#555555', fontFamily: 'JetBrains Mono, monospace' }}
                        axisLine={false}
                        tickLine={false}
                        width={40}
                      />
                      <Tooltip content={<CustomTooltip outcomeLabels={chartOutcomes.map(o => o.label)} />} />
                      {chartOutcomes.map((o, i) => (
                        <Line
                          key={o.market_id}
                          type="monotone"
                          dataKey={o.label}
                          stroke={OUTCOME_COLOURS[i] ?? OUTCOME_COLOURS[OUTCOME_COLOURS.length - 1]}
                          strokeWidth={i === 0 ? 2 : 1.5}
                          dot={false}
                          isAnimationActive={false}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                  {!hasHistory && (
                    <span style={{ position: 'absolute', bottom: 8, left: 8, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: '#555' }}>
                      History building...
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                  {chartOutcomes.map((o, i) => {
                    const colour = OUTCOME_COLOURS[i] ?? OUTCOME_COLOURS[OUTCOME_COLOURS.length - 1];
                    return (
                      <span key={o.market_id} className="flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colour }} />
                        <span className="font-mono text-[10px] text-muted">{o.label}</span>
                        <span className="font-mono text-[10px] text-white font-semibold">{(o.probability * 100).toFixed(1)}%</span>
                      </span>
                    );
                  })}
                </div>
              </>
            )}

            {/* BAR chart (or fallback when no line) */}
            {chartDecision.type === 'bar' && (
              <div className="space-y-1.5">
                {chartOutcomes.map((o, i) => {
                  const colour = OUTCOME_COLOURS[i] ?? OUTCOME_COLOURS[OUTCOME_COLOURS.length - 1];
                  const barW = maxProb > 0 ? `max(4px, ${(o.probability / maxProb) * 100}%)` : '0%';
                  return (
                    <div key={o.market_id} className="flex items-center gap-3">
                      <span className="font-mono text-xs text-white w-12 text-right font-semibold flex-shrink-0">
                        {(o.probability * 100).toFixed(1)}%
                      </span>
                      <div className="flex-1 h-4 rounded bg-subtle overflow-hidden relative">
                        <div className="h-full rounded transition-all duration-500" style={{ width: barW, background: colour }} />
                        <span className="absolute inset-0 flex items-center px-2 font-mono text-[10px] font-medium truncate text-white">
                          {o.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>)}

          {/* ── Clickable outcome snapshot — always shown ── */}
          <div className="mt-5 space-y-1">
            {isIndependent && (
              <p className="font-mono text-[10px] text-blue-400 mb-2">INDEPENDENT — each outcome resolves separately</p>
            )}
            <div className="flex items-center justify-between mb-1">
              <p className="font-mono text-[10px] text-muted uppercase tracking-widest">
                {selectedOutcomeLabel ? `Filtering: ${selectedOutcomeLabel}` : 'Click an outcome to filter bets'}
              </p>
              {selectedOutcome && (
                <button
                  onClick={() => setSelectedOutcome(null)}
                  className="font-mono text-[10px] text-accent hover:text-white transition-colors"
                >
                  Clear filter
                </button>
              )}
            </div>
            {barOutcomes.map((o) => {
              const isSelected = selectedOutcome === o.market_id;
              const barWidth = isIndependent
                ? `max(4px, ${o.probability * 100}%)`
                : maxProb > 0 ? `max(4px, ${(o.probability / maxProb) * 100}%)` : '0%';
              const colour = OUTCOME_COLOURS[activeOutcomes.indexOf(o)] ?? (o.passed ? '#444444' : '#555555');
              const barColor = o.passed ? '#444444' : colour;
              const count = betCountByMarket[o.market_id] || 0;
              const divPct = Math.abs(o.divergence * 100);

              return (
                <button
                  key={o.market_id}
                  onClick={() => !o.passed && handleBarClick(o.market_id)}
                  className={clsx(
                    'flex items-center gap-3 w-full rounded px-1 py-0.5 transition-all text-left',
                    o.passed
                      ? 'opacity-50 cursor-default'
                      : isSelected
                      ? 'bg-white/5 ring-1 ring-accent/60'
                      : 'hover:bg-white/[0.03] cursor-pointer'
                  )}
                >
                  <span className="font-mono text-xs text-white w-12 text-right font-semibold flex-shrink-0">
                    {(o.probability * 100).toFixed(1)}%
                  </span>
                  <div className="flex-1 h-5 rounded bg-subtle overflow-hidden relative">
                    <div
                      className="h-full rounded transition-all duration-500"
                      style={{
                        width: barWidth,
                        background: isSelected ? colour : barColor,
                        opacity: isSelected ? 1 : 0.8,
                      }}
                    />
                    <span className="absolute inset-0 flex items-center justify-between px-2">
                      <span className="font-mono text-[10px] font-medium truncate text-white">
                        {o.label}
                      </span>
                      <span className="flex items-center gap-2 flex-shrink-0">
                        {count > 0 && (
                          <span className="font-mono text-[9px] text-white/50">
                            {count} bet{count !== 1 ? 's' : ''}
                          </span>
                        )}
                        {divPct >= 3 && !o.passed && (
                          <span className={clsx(
                            'font-mono text-[9px] font-bold',
                            o.divergence > 0 ? 'text-green-400/70' : 'text-red-400/70'
                          )}>
                            {o.divergence > 0 ? '+' : '\u2212'}{divPct.toFixed(0)}% vs PM
                          </span>
                        )}
                      </span>
                    </span>
                  </div>
                  {o.passed && (
                    <span className="rounded bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-400 flex-shrink-0">
                      PASSED
                    </span>
                  )}
                </button>
              );
            })}
            {hiddenBarCount > 0 && (
              <p className="font-mono text-[10px] text-muted text-center pt-1">
                +{hiddenBarCount} more outcomes
              </p>
            )}
          </div>

          {/* Agent consensus timeline */}
          {bets.length >= 2 && (
            <AgentConsensusTimeline
              bets={bets}
              outcomes={sorted.filter(o => !o.passed).map(o => ({ market_id: o.market_id, label: o.label }))}
              priceHistory={priceHistory}
              outcomeIndexMap={outcomeIndexMap}
              selectedOutcome={selectedOutcome}
            />
          )}
        </div>

        {/* Bets section */}
        <div className="p-6">
          {loading ? (
            <p className="font-mono text-xs text-muted animate-pulse text-center py-8">Loading agent bets...</p>
          ) : bets.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <p className="font-mono text-sm text-muted">No agent bets on this event yet</p>
              <p className="font-mono text-[10px] text-muted/60">
                When AI agents bet on this event, their reasoning will appear here.
              </p>
            </div>
          ) : (
            <div>
              {/* Bets header with sort controls */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-mono text-xs text-muted uppercase tracking-widest">
                  {selectedOutcomeLabel
                    ? `${filteredBets.length} bet${filteredBets.length !== 1 ? 's' : ''} on "${selectedOutcomeLabel}"`
                    : `AGENT BETS (${bets.length})`
                  }
                </h3>
                <div className="flex gap-1">
                  {([
                    { key: 'recent' as SortMode, label: 'Recent' },
                    { key: 'confidence' as SortMode, label: 'Confidence' },
                    { key: 'wager' as SortMode, label: 'Wager' },
                  ]).map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setSortMode(s.key)}
                      className={clsx(
                        'rounded-full px-2 py-0.5 font-mono text-[9px] font-bold transition-colors',
                        sortMode === s.key
                          ? 'bg-accent/20 text-accent border border-accent/40'
                          : 'bg-subtle/50 text-muted hover:text-white border border-transparent'
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredBets.length === 0 ? (
                <p className="font-mono text-[10px] text-muted text-center py-6">
                  No bets on this outcome yet
                </p>
              ) : (
                <BetThread bets={filteredBets} defaultExpanded={true} />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border">
          <PolymarketButton url={event.polymarket_url} question={event.title} size="lg" />
        </div>
      </div>
    </div>
  );
}
