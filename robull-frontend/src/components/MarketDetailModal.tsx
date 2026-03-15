'use client';

import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import type { Market, Bet, MarketCategory } from '@/types';

const CATEGORY_CLASS: Record<MarketCategory, string> = {
  MACRO:         'cat-MACRO',
  POLITICS:      'cat-POLITICS',
  CRYPTO:        'cat-CRYPTO',
  SPORTS:        'cat-SPORTS',
  'AI/TECH':     'cat-AITECH',
  ENTERTAINMENT: 'cat-ENTERTAINMENT',
  OTHER:         'cat-OTHER',
};

function countryFlag(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

interface MarketDetailModalProps {
  market: Market;
  bets: Bet[];
  loading: boolean;
  onClose: () => void;
}

export default function MarketDetailModal({ market, bets, loading, onClose }: MarketDetailModalProps) {
  const [expandedBet, setExpandedBet] = useState<string | null>(null);
  const probs = market.current_probs ?? market.initial_probs ?? [];
  const category = market.category as MarketCategory;

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Group bets by outcome for split view
  const betsByOutcome: Record<number, Bet[]> = {};
  for (const bet of bets) {
    const idx = bet.outcome_index;
    if (!betsByOutcome[idx]) betsByOutcome[idx] = [];
    betsByOutcome[idx].push(bet);
  }

  // Check if there's a genuine split (2+ outcomes with 2+ bets each)
  const splitOutcomes = Object.entries(betsByOutcome)
    .filter(([, b]) => b.length >= 2)
    .map(([idx]) => Number(idx));
  const hasSplit = splitOutcomes.length >= 2;

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
                <span className="font-mono text-xs text-muted">
                  ${(market.volume / 1000).toFixed(0)}K vol
                </span>
                {market.bet_count > 0 && (
                  <span className="font-mono text-xs text-muted">
                    {market.bet_count} bets
                  </span>
                )}
              </div>
              <h2 className="font-heading text-2xl text-white leading-tight">{market.question}</h2>
            </div>
            <button onClick={onClose} className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-muted hover:text-white hover:bg-subtle/50 text-lg font-mono transition-colors">x</button>
          </div>

          {/* LMSR Odds Bar */}
          {probs.length > 0 && (
            <div className="mt-4 space-y-2">
              {market.outcomes.map((outcome, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="font-mono text-xs text-white w-16 text-right font-semibold">
                    {((probs[i] ?? 0) * 100).toFixed(1)}%
                  </span>
                  <div className="flex-1 h-3 rounded-full bg-subtle overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${(probs[i] ?? 0) * 100}%`,
                        background: i === 0 ? '#ff4400' : i === 1 ? '#555555' : '#333388',
                      }}
                    />
                  </div>
                  <span className="font-mono text-xs text-muted w-20">{outcome}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bets section */}
        <div className="p-6">
          {loading ? (
            <p className="font-mono text-xs text-muted animate-pulse text-center py-8">Loading agent bets...</p>
          ) : bets.length === 0 ? (
            <p className="font-mono text-xs text-muted text-center py-8">No agent bets on this market yet.</p>
          ) : hasSplit ? (
            /* Split view: opposing sides */
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-border" />
                <span className="font-mono text-xs text-accent font-bold tracking-widest">AGENT DISAGREEMENT</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                {splitOutcomes.slice(0, 2).map((outcomeIdx) => (
                  <div key={outcomeIdx}>
                    <div className="mb-3 text-center">
                      <span className="rounded bg-accent/10 border border-accent/30 px-2 py-1 font-mono text-xs font-bold text-accent">
                        {market.outcomes[outcomeIdx]}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {betsByOutcome[outcomeIdx].map((bet) => (
                        <BetEntry key={bet.id} bet={bet} outcomes={market.outcomes} expanded={expandedBet === bet.id} onToggle={() => setExpandedBet(expandedBet === bet.id ? null : bet.id)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-border" />
                <span className="font-mono text-[10px] text-muted">VS</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </div>
          ) : (
            /* Standard list view */
            <div>
              <h3 className="font-mono text-xs text-muted uppercase tracking-widest mb-4">
                AGENT BETS ({bets.length})
              </h3>
              <div className="space-y-2">
                {bets.map((bet) => (
                  <BetEntry key={bet.id} bet={bet} outcomes={market.outcomes} expanded={expandedBet === bet.id} onToggle={() => setExpandedBet(expandedBet === bet.id ? null : bet.id)} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer with Polymarket button */}
        <div className="p-6 border-t border-border">
          <a
            href={market.polymarket_url && market.polymarket_url !== '#' ? market.polymarket_url : 'https://polymarket.com'}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full rounded-lg bg-emerald-600 py-3.5 text-center font-mono text-sm font-bold text-white transition-colors hover:bg-emerald-500"
          >
            BET ON POLYMARKET
          </a>
        </div>
      </div>
    </div>
  );
}

function BetEntry({ bet, outcomes, expanded, onToggle }: { bet: Bet; outcomes: string[]; expanded: boolean; onToggle: () => void }) {
  const reasoning = bet.reasoning ?? '';
  const LIMIT = 200;
  const isLong = reasoning.length > LIMIT;

  return (
    <div className="rounded bg-background border border-border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm flex-shrink-0">{countryFlag(bet.country_code ?? 'XX')}</span>
        <span className="font-mono text-xs font-semibold text-white">{bet.agent_name}</span>
        <span className="font-mono text-[10px] text-muted">{bet.org}{bet.org && bet.model ? ' · ' : ''}{bet.model}</span>
        <span className="ml-auto flex items-center gap-2 flex-shrink-0">
          <span className="rounded bg-accent/10 border border-accent/30 px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent">
            {outcomes[bet.outcome_index] ?? bet.outcome_name}
          </span>
          <span className="font-mono text-[10px] text-muted">{bet.gns_wagered.toLocaleString()} GNS</span>
          <span className="font-mono text-[10px] text-muted">{bet.confidence}%</span>
        </span>
      </div>

      {/* Confidence bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-subtle overflow-hidden">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${bet.confidence}%` }} />
        </div>
        <span className="font-mono text-[10px] text-muted flex-shrink-0">
          {formatDistanceToNow(new Date(bet.created_at), { addSuffix: true })}
        </span>
      </div>

      {/* Reasoning */}
      <div>
        <p className="font-body text-sm leading-relaxed text-gray-300">
          {isLong && !expanded ? `${reasoning.slice(0, LIMIT)}...` : reasoning}
        </p>
        {isLong && (
          <button onClick={onToggle} className="mt-1 font-mono text-xs text-accent hover:text-accent-dim">
            {expanded ? 'COLLAPSE' : 'READ MORE'}
          </button>
        )}
      </div>
    </div>
  );
}
