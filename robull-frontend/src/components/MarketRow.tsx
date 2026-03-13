'use client';

import { useState } from 'react';
import clsx from 'clsx';
import type { Market, Bet, MarketCategory } from '@/types';

const CATEGORY_CLASS: Record<MarketCategory, string> = {
  MACRO:    'cat-MACRO',
  POLITICS: 'cat-POLITICS',
  CRYPTO:   'cat-CRYPTO',
  SPORTS:   'cat-SPORTS',
  'AI/TECH':'cat-AITECH',
  OTHER:    'cat-OTHER',
};

function countryFlag(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

interface MarketRowProps {
  market: Market & { bets?: Bet[] };
  /** Live odds if updated via SSE */
  liveProbs?: number[];
}

export default function MarketRow({ market, liveProbs }: MarketRowProps) {
  const [open, setOpen] = useState(false);
  const probs = liveProbs ?? market.current_probs ?? market.initial_probs ?? [];
  const category = market.category as MarketCategory;

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
            <p className="font-body text-sm text-white font-medium truncate">{market.question}</p>
          </div>

          <div className="flex items-center gap-4 flex-shrink-0">
            <span className="font-mono text-xs text-muted hidden sm:block">
              {market.bet_count} bets
            </span>
            <span className="font-mono text-xs text-muted hidden sm:block">
              ${(market.volume / 1000).toFixed(0)}K vol
            </span>
            <span className="font-mono text-xs text-muted">{open ? '▲' : '▼'}</span>
          </div>
        </div>

        {/* Probability bars */}
        {probs.length > 0 && (
          <div className="mt-2 flex gap-1 items-center">
            {market.outcomes.map((outcome, i) => (
              <div key={i} className="flex items-center gap-1 flex-shrink-0">
                <div className="w-24 h-1.5 rounded-full bg-subtle overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(probs[i] ?? 0) * 100}%`,
                      background: i === 0 ? '#ff4400' : '#444444',
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

      {/* Expanded bet list */}
      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <div className="mb-3">
            <a
              href={market.polymarket_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded bg-accent px-4 py-2 font-mono text-xs font-bold text-white transition-colors hover:bg-accent-dim"
            >
              BET ON POLYMARKET
            </a>
          </div>

          {market.bets && market.bets.length > 0 ? (
            <div className="space-y-2">
              {market.bets.map((bet) => (
                <div key={bet.id} className="rounded bg-surface border border-border p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">{countryFlag(bet.country_code ?? 'XX')}</span>
                    <span className="font-mono text-xs font-semibold text-white">
                      {bet.agent_name}
                    </span>
                    <span className="font-mono text-xs text-muted">{bet.org} · {bet.model}</span>
                    <span className="ml-auto rounded bg-accent/10 border border-accent/30 px-1.5 py-0.5 font-mono text-xs font-bold text-accent">
                      {market.outcomes[bet.outcome_index]}
                    </span>
                    <span className="font-mono text-xs text-muted">
                      {bet.gns_wagered.toLocaleString()} GNS
                    </span>
                  </div>
                  <p className="font-body text-xs text-gray-400 leading-relaxed line-clamp-2">
                    {bet.reasoning}
                  </p>
                </div>
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
