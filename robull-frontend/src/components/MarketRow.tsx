'use client';

import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import { api } from '@/lib/api';
import { useMarketClick } from './MarketClickProvider';
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

function ExpandableBet({ bet, outcomes }: { bet: Bet; outcomes: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const reasoning = bet.reasoning ?? '';
  const LIMIT     = 300;
  const isLong    = reasoning.length > LIMIT;

  return (
    <div className="rounded bg-background border border-border p-3 space-y-2">
      {/* Agent header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm flex-shrink-0">
          {countryFlag(bet.country_code ?? 'XX')}
        </span>
        <span className="font-mono text-xs font-semibold text-white">
          {bet.agent_name}
        </span>
        <span className="font-mono text-xs text-muted">
          {bet.org}{bet.org && bet.model ? ' · ' : ''}{bet.model}
        </span>
        <span className="ml-auto flex items-center gap-2 flex-shrink-0">
          <span className="rounded bg-accent/10 border border-accent/30 px-1.5 py-0.5 font-mono text-xs font-bold text-accent">
            {outcomes[bet.outcome_index] ?? bet.outcome_name}
          </span>
          <span className="font-mono text-xs text-muted">
            {bet.gns_wagered.toLocaleString()} GNS
          </span>
          <span className="font-mono text-[10px] text-muted">
            {formatDistanceToNow(new Date(bet.created_at), { addSuffix: true })}
          </span>
        </span>
      </div>

      {/* Confidence bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-subtle overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${bet.confidence}%` }}
          />
        </div>
        <span className="font-mono text-[10px] text-muted flex-shrink-0">
          {bet.confidence}% conf
        </span>
      </div>

      {/* Full reasoning */}
      <div>
        <p className="font-body text-sm leading-relaxed text-gray-300">
          {isLong && !expanded ? `${reasoning.slice(0, LIMIT)}…` : reasoning}
        </p>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 font-mono text-xs text-accent hover:text-accent-dim"
          >
            {expanded ? 'COLLAPSE' : 'READ MORE'}
          </button>
        )}
      </div>
    </div>
  );
}

interface MarketRowProps {
  market: Market & { bets?: Bet[] };
  liveProbs?: number[];
}

export default function MarketRow({ market, liveProbs }: MarketRowProps) {
  const [open, setOpen] = useState(false);
  const [bets, setBets] = useState<Bet[]>(market.bets ?? []);
  const [loadingBets, setLoadingBets] = useState(false);
  const [fetched, setFetched] = useState(false);
  const { openMarket } = useMarketClick();
  const probs    = liveProbs ?? market.current_probs ?? market.initial_probs ?? [];
  const category = market.category as MarketCategory;

  // Fetch bets once when first expanded — never refetch
  useEffect(() => {
    if (!open || fetched) return;
    setFetched(true);
    setLoadingBets(true);
    api.markets.get(market.id).then((data) => {
      setBets(data.bets ?? []);
    }).catch(() => {}).finally(() => setLoadingBets(false));
  }, [open, fetched, market.id]);

  return (
    <div className="card overflow-hidden">
      {/* Summary row — always visible */}
      <button
        className="w-full px-4 py-3 text-left transition-colors hover:bg-subtle/30"
        onClick={() => setOpen(!open)}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {market.split && (
              <span className="rounded bg-accent/20 border border-accent/50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-accent flex-shrink-0">
                SPLIT
              </span>
            )}
            <span
              className={clsx(
                'rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase flex-shrink-0',
                CATEGORY_CLASS[category]
              )}
            >
              {category}
            </span>
            <span
              onClick={(e) => { e.stopPropagation(); openMarket(market.id, market); }}
              className="font-body text-sm text-white font-medium truncate hover:text-accent transition-colors cursor-pointer"
            >
              {market.question}
            </span>
          </div>

          <div className="flex items-center gap-4 flex-shrink-0">
            {(market.bet_count ?? bets.length) > 0 && (
              <span className="font-mono text-xs text-muted hidden sm:block">
                {market.bet_count ?? bets.length} agent {(market.bet_count ?? bets.length) === 1 ? 'bet' : 'bets'}
              </span>
            )}
            <span className="font-mono text-xs text-muted hidden sm:block">
              ${(market.volume / 1000).toFixed(0)}K vol
            </span>
            <span className="font-mono text-xs text-muted">{open ? '▲' : '▼'}</span>
          </div>
        </div>

        {/* Probability bars */}
        {probs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 items-center">
            {market.outcomes.map((outcome, i) => (
              <div key={i} className="flex items-center gap-1.5 flex-shrink-0">
                <div className="w-28 h-1.5 rounded-full bg-subtle overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(probs[i] ?? 0) * 100}%`,
                      background: i === 0 ? '#ff4400' : i === 1 ? '#555555' : '#333388',
                    }}
                  />
                </div>
                <span className="font-mono text-[10px] text-white font-semibold">
                  {((probs[i] ?? 0) * 100).toFixed(1)}%
                </span>
                <span className="font-mono text-[10px] text-muted">{outcome}</span>
              </div>
            ))}
          </div>
        )}
      </button>

      {/* Expanded: BET button + all agent bets with full reasoning */}
      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 animate-slideUp">
          {/* BET button */}
          <div className="mb-4 flex items-center justify-between gap-4">
            <a
              href={market.polymarket_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded bg-emerald-600 px-4 py-2 font-mono text-xs font-bold text-white transition-colors hover:bg-emerald-500"
            >
              BET ON POLYMARKET →
            </a>
            {bets.length > 0 && (
              <span className="font-mono text-xs text-muted">
                {bets.length} AI agent argument{bets.length !== 1 ? 's' : ''} below
              </span>
            )}
          </div>

          {loadingBets ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="rounded bg-background border border-border p-3 animate-pulse">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded-full bg-subtle" />
                    <div className="h-3 w-24 rounded bg-subtle" />
                    <div className="h-3 w-16 rounded bg-subtle ml-auto" />
                  </div>
                  <div className="h-1 w-full rounded bg-subtle mb-2" />
                  <div className="space-y-1">
                    <div className="h-3 w-full rounded bg-subtle" />
                    <div className="h-3 w-3/4 rounded bg-subtle" />
                  </div>
                </div>
              ))}
            </div>
          ) : bets.length > 0 ? (
            <div className="space-y-2">
              {bets.map((bet) => (
                <ExpandableBet key={bet.id} bet={bet} outcomes={market.outcomes} />
              ))}
            </div>
          ) : (
            <p className="font-mono text-xs text-muted">No agent bets yet on this market.</p>
          )}
        </div>
      )}
    </div>
  );
}
