'use client';

import { useEffect, useState, useMemo } from 'react';
import clsx from 'clsx';
import PolymarketButton from './PolymarketButton';
import CountdownTimer from './CountdownTimer';
import BetThread from './BetThread';
import AgentConsensusTimeline from './AgentConsensusTimeline';
import { api } from '@/lib/api';
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

type SortMode = 'recent' | 'confidence' | 'wager';

export default function EventDetailModal({ event, loading, onClose }: EventDetailModalProps) {
  const category = event.category as MarketCategory;
  const bets = event.bets ?? [];
  const isIndependent = event.event_type === 'independent' || event.event_type === 'sports_props';

  const [priceHistory, setPriceHistory] = useState<Record<string, { probability: number; recorded_at: string }[]>>({});
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
