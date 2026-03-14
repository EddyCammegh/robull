'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import BetCard from './BetCard';
import { useSSE } from '@/lib/sse';
import { MOCK_BETS, generateLiveMockBet } from '@/lib/mockData';
import type { Bet, SSEEvent } from '@/types';

const LIVE_DOT = (
  <span className="inline-flex items-center gap-1.5">
    <span className="h-2 w-2 rounded-full bg-accent animate-pulse-dot" />
    <span className="font-mono text-xs text-accent">LIVE</span>
  </span>
);

// Random interval 30–60 seconds — slow enough to read each bet
function nextInterval() {
  return 30_000 + Math.floor(Math.random() * 30_000);
}

interface LiveFeedProps {
  initialBets: Bet[];
  keyword?: string;
  category?: string;
  agentFilter?: string;
  pinnedBetId?: string | null;
  onPin?: (id: string | null) => void;
}

export default function LiveFeed({
  initialBets,
  keyword = '',
  category = '',
  agentFilter = '',
  pinnedBetId,
  onPin,
}: LiveFeedProps) {
  const seed = initialBets.length > 0 ? initialBets : MOCK_BETS;
  const [bets, setBets] = useState<(Bet & { _new?: boolean })[]>(seed);
  const sseReceivedRef  = useRef(false);
  const timerRef        = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSSE = useCallback((event: SSEEvent) => {
    if (event.type !== 'bet') return;
    sseReceivedRef.current = true;

    const raw  = event.bet;
    const flat: Bet & { _new?: boolean } = {
      ...raw,
      agent_name:     raw.agent.name,
      country_code:   raw.agent.country_code,
      org:            raw.agent.org,
      model:          raw.agent.model,
      question:       raw.market.question,
      polymarket_url: raw.market.polymarket_url,
      category:       raw.market.category,
      outcomes:       raw.market.outcomes,
      outcome_name:   raw.outcome_name,
      settled:        false,
      gns_returned:   null,
      _new:           true,
    };
    setBets((prev) => [flat, ...prev].slice(0, 200));
  }, []);

  useSSE(handleSSE);

  // Mock live stream — fires every 30-60s when no real SSE is connected
  useEffect(() => {
    function schedule() {
      timerRef.current = setTimeout(() => {
        if (!sseReceivedRef.current) {
          const bet: Bet & { _new?: boolean } = { ...generateLiveMockBet(), _new: true };
          setBets((prev) => [bet, ...prev].slice(0, 200));
        }
        schedule();
      }, nextInterval());
    }
    schedule();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const filtered = bets.filter((b) => {
    if (agentFilter && b.agent_id !== agentFilter) return false;
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

  const pinnedBet = pinnedBetId ? filtered.find((b) => b.id === pinnedBetId) ?? null : null;
  const rest      = filtered.filter((b) => b.id !== pinnedBetId);

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        {LIVE_DOT}
        <span className="font-mono text-xs text-muted">{filtered.length} bets</span>
        {agentFilter && (
          <span className="font-mono text-xs text-accent border border-accent/30 rounded px-1.5 py-0.5">
            agent filter active
          </span>
        )}
        {pinnedBet && (
          <span className="font-mono text-xs text-muted border border-border rounded px-1.5 py-0.5">
            1 pinned
          </span>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-mono text-sm text-muted">No bets match the current filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Pinned bet floats to top */}
          {pinnedBet && (
            <BetCard
              key={`pinned-${pinnedBet.id}`}
              bet={pinnedBet}
              isNew={pinnedBet._new}
              isPinned
              onPin={onPin}
            />
          )}

          {/* Divider when something is pinned */}
          {pinnedBet && rest.length > 0 && (
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-border" />
              <span className="font-mono text-[10px] text-muted uppercase tracking-widest">
                live feed
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>
          )}

          {rest.map((bet) => (
            <BetCard
              key={bet.id}
              bet={bet}
              isNew={bet._new}
              isPinned={false}
              onPin={onPin}
            />
          ))}
        </div>
      )}
    </div>
  );
}
