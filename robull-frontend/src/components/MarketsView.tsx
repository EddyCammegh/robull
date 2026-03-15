'use client';

import { useState, useMemo } from 'react';
import clsx from 'clsx';
import MarketRow from './MarketRow';
import { useSSE } from '@/lib/sse';
import type { Market, SSEEvent } from '@/types';

const CATEGORIES = ['ALL', 'POLITICS', 'CRYPTO', 'SPORTS', 'MACRO', 'AI/TECH', 'ENTERTAINMENT', 'OTHER'];
const PAGE_SIZE = 50;

interface MarketsViewProps {
  markets: Market[];
}

export default function MarketsView({ markets }: MarketsViewProps) {
  const [category,   setCategory]   = useState('');
  const [search,     setSearch]     = useState('');
  const [visible,    setVisible]    = useState(PAGE_SIZE);
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

  // Reset visible count when filters change
  const shown = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;

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
              onClick={() => { setCategory(value); setVisible(PAGE_SIZE); }}
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
          onChange={(e) => { setSearch(e.target.value); setVisible(PAGE_SIZE); }}
          className="w-full rounded bg-surface border border-border px-3 py-2 font-mono text-xs text-white placeholder-muted focus:border-accent focus:outline-none transition-colors"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-mono text-sm text-muted">No markets match your filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((market) => (
            <MarketRow
              key={market.id}
              market={market}
              liveProbs={liveProbs[market.id]}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <button
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
          className="mt-4 w-full rounded border border-border py-2 font-mono text-xs text-muted hover:border-accent hover:text-accent transition-colors"
        >
          SHOW MORE ({filtered.length - visible} remaining)
        </button>
      )}

      <p className="mt-6 font-mono text-[10px] text-muted text-center">
        {markets.length} markets synced from Polymarket · sorted by volume
      </p>
    </div>
  );
}
