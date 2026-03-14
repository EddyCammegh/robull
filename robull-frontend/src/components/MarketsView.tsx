'use client';

import { useState, useMemo } from 'react';
import clsx from 'clsx';
import MarketRow from './MarketRow';
import { useSSE } from '@/lib/sse';
import type { Market, Bet, SSEEvent } from '@/types';

const CATEGORIES = ['ALL', 'MACRO', 'POLITICS', 'CRYPTO', 'SPORTS', 'AI/TECH', 'OTHER'];

interface MarketsViewProps {
  markets: (Market & { bets: Bet[] })[];
}

export default function MarketsView({ markets }: MarketsViewProps) {
  const [category,   setCategory]   = useState('');
  const [search,     setSearch]     = useState('');
  const [liveProbs,  setLiveProbs]  = useState<Record<string, number[]>>({});

  // Apply live SSE odds updates
  useSSE((event: SSEEvent) => {
    if (event.type === 'odds') {
      setLiveProbs((prev) => ({ ...prev, [event.marketId]: event.probs }));
    }
  });

  const filtered = useMemo(() => {
    return markets.filter((m) => {
      if (category && m.category !== category) return false;
      if (search) {
        const kw = search.toLowerCase();
        return m.question.toLowerCase().includes(kw);
      }
      return true;
    });
  }, [markets, category, search]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="font-heading text-4xl text-white">MARKETS</h1>
        <span className="font-mono text-sm text-muted">{filtered.length} open</span>
      </div>

      {/* Filters row */}
      <div className="mb-4 flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => {
          const value    = cat === 'ALL' ? '' : cat;
          const isActive = category === value;
          return (
            <button
              key={cat}
              onClick={() => setCategory(value)}
              className={clsx(
                'rounded px-3 py-1.5 font-mono text-xs transition-colors',
                isActive
                  ? 'bg-accent text-white'
                  : 'border border-border text-muted hover:border-accent hover:text-accent'
              )}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search markets…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded bg-surface border border-border px-3 py-2 font-mono text-xs text-white placeholder-muted focus:border-accent focus:outline-none transition-colors"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-mono text-sm text-muted">No markets match your filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((market) => (
            <MarketRow
              key={market.id}
              market={market}
              liveProbs={liveProbs[market.id]}
            />
          ))}
        </div>
      )}

      <p className="mt-6 font-mono text-[10px] text-muted text-center">
        Live markets from Polymarket · volume &gt; $5K · synced hourly
      </p>
    </div>
  );
}
