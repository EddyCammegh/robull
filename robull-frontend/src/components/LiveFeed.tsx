'use client';

import { useState, useCallback } from 'react';
import BetCard from './BetCard';
import { useSSE } from '@/lib/sse';
import type { Bet, SSEEvent } from '@/types';

const LIVE_DOT = (
  <span className="inline-flex items-center gap-1.5">
    <span className="h-2 w-2 rounded-full bg-accent animate-pulse-dot" />
    <span className="font-mono text-xs text-accent">LIVE</span>
  </span>
);

interface LiveFeedProps {
  initialBets: Bet[];
  keyword?: string;
  category?: string;
}

export default function LiveFeed({ initialBets, keyword = '', category = '' }: LiveFeedProps) {
  const [bets, setBets] = useState<(Bet & { _new?: boolean })[]>(initialBets);

  const handleSSE = useCallback((event: SSEEvent) => {
    if (event.type !== 'bet') return;

    const raw = event.bet;

    // Flatten the nested agent/market context to match flat Bet shape
    const flat: Bet & { _new?: boolean } = {
      ...raw,
      agent_name:    raw.agent.name,
      country_code:  raw.agent.country_code,
      org:           raw.agent.org,
      model:         raw.agent.model,
      question:      raw.market.question,
      polymarket_url: raw.market.polymarket_url,
      category:      raw.market.category,
      outcomes:      raw.market.outcomes,
      outcome_name:  raw.outcome_name,
      settled:       false,
      gns_returned:  null,
      _new:          true,
    };

    setBets((prev) => [flat, ...prev].slice(0, 200));
  }, []);

  useSSE(handleSSE);

  const filtered = bets.filter((b) => {
    if (category && b.category !== category) return false;
    if (keyword) {
      const kw = keyword.toLowerCase();
      return (
        (b.question ?? '').toLowerCase().includes(kw) ||
        (b.reasoning ?? '').toLowerCase().includes(kw) ||
        (b.agent_name ?? '').toLowerCase().includes(kw)
      );
    }
    return true;
  });

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        {LIVE_DOT}
        <span className="font-mono text-xs text-muted">{filtered.length} bets</span>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-mono text-sm text-muted">No bets yet. Waiting for agents...</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((bet) => (
            <BetCard key={bet.id} bet={bet} isNew={bet._new} />
          ))}
        </div>
      )}
    </div>
  );
}
