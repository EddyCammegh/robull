'use client';

import { useEffect } from 'react';
import clsx from 'clsx';
import PolymarketButton from './PolymarketButton';
import CountdownTimer from './CountdownTimer';
import BetThread from './BetThread';
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

export default function EventDetailModal({ event, loading, onClose }: EventDetailModalProps) {
  const category = event.category as MarketCategory;
  const bets = event.bets ?? [];
  const isIndependent = event.event_type === 'independent' || event.event_type === 'sports_props';

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const sorted = [...event.outcomes].sort((a, b) => {
    if (a.passed !== b.passed) return a.passed ? 1 : 0;
    return b.probability - a.probability;
  });

  const maxProb = sorted.length > 0 ? sorted[0].probability : 1;

  // Group bets by outcome_label
  const betsByOutcome: Record<string, Bet[]> = {};
  for (const bet of bets) {
    const label = (bet as any).outcome_label ?? 'Unknown';
    if (!betsByOutcome[label]) betsByOutcome[label] = [];
    betsByOutcome[label].push(bet);
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
              {event.active_agent_count > 0 && (
                <p className="font-mono text-[10px] text-muted mt-1">
                  {event.active_agent_count} agent{event.active_agent_count !== 1 ? 's' : ''} betting · b={Math.round(event.lmsr_b)}
                </p>
              )}
            </div>
            <button onClick={onClose} className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-muted hover:text-white hover:bg-subtle/50 text-lg font-mono transition-colors">x</button>
          </div>

          {/* Outcome bars */}
          <div className="mt-4 space-y-1.5">
            {sorted.map((o) => {
              const barWidth = isIndependent
                ? `max(4px, ${o.probability * 100}%)`
                : maxProb > 0 ? `max(4px, ${(o.probability / maxProb) * 100}%)` : '0%';
              const barColor = o.passed ? '#444444' : isIndependent ? '#60a5fa' : '#ff4400';

              return (
                <div key={o.market_id} className="flex items-center gap-3">
                  <span className="font-mono text-xs text-white w-12 text-right font-semibold flex-shrink-0">
                    {(o.probability * 100).toFixed(1)}%
                  </span>
                  <div className="flex-1 h-4 rounded bg-subtle overflow-hidden relative">
                    <div className="h-full rounded transition-all duration-500" style={{ width: barWidth, background: barColor }} />
                    <span className="absolute inset-0 flex items-center px-2 font-mono text-[10px] font-medium truncate text-white">
                      {o.label}
                    </span>
                  </div>
                  {o.passed && (
                    <span className="rounded bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-400 flex-shrink-0">
                      PASSED
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bets section */}
        <div className="p-6">
          {loading ? (
            <p className="font-mono text-xs text-muted animate-pulse text-center py-8">Loading agent bets...</p>
          ) : bets.length === 0 ? (
            <p className="font-mono text-xs text-muted text-center py-8">No agent bets on this event yet.</p>
          ) : (
            <div>
              <h3 className="font-mono text-xs text-muted uppercase tracking-widest mb-4">
                AGENT BETS ({bets.length})
              </h3>
              <BetThread bets={bets} defaultExpanded={true} />
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

