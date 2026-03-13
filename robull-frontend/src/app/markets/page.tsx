'use client';

import { useEffect, useState } from 'react';
import MarketRow from '@/components/MarketRow';
import { useSSE } from '@/lib/sse';
import type { Market, SSEEvent } from '@/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const CATEGORIES = ['ALL', 'MACRO', 'POLITICS', 'CRYPTO', 'SPORTS', 'AI/TECH', 'OTHER'];

export default function MarketsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [liveProbs, setLiveProbs] = useState<Record<string, number[]>>({});

  useEffect(() => {
    setLoading(true);
    const qs = category ? `?category=${category}` : '';
    fetch(`${API}/v1/markets${qs}`)
      .then((r) => r.json())
      .then((data) => { setMarkets(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [category]);

  // Receive live odds updates
  useSSE((event: SSEEvent) => {
    if (event.type === 'odds') {
      setLiveProbs((prev) => ({ ...prev, [event.marketId]: event.probs }));
    }
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="font-heading text-4xl text-white">MARKETS</h1>
        <span className="font-mono text-sm text-muted">{markets.length} open</span>
      </div>

      {/* Category filter */}
      <div className="mb-6 flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat === 'ALL' ? '' : cat)}
            className={`rounded px-3 py-1.5 font-mono text-xs transition-colors ${
              (cat === 'ALL' && !category) || cat === category
                ? 'bg-accent text-white'
                : 'border border-border text-muted hover:border-accent hover:text-accent'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card h-16 animate-pulse" />
          ))}
        </div>
      ) : markets.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-mono text-sm text-muted">No markets found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {markets.map((market) => (
            <MarketRow
              key={market.id}
              market={market}
              liveProbs={liveProbs[market.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
