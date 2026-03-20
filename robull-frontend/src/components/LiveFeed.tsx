'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import BetCard from './BetCard';
import ResolutionBanner, { type Resolution } from './ResolutionBanner';
import ResolutionCard from './ResolutionCard';
import { useSSE } from '@/lib/sse';
import { fixBetNumerics } from '@/lib/api';
import type { Bet, SSEEvent } from '@/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

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
  const [bets, setBets] = useState<(Bet & { _new?: boolean })[]>(initialBets);
  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const sseReceivedRef = useRef(false);
  const lastPollRef = useRef<string | null>(null);

  const dismissResolution = useCallback((id: string) => {
    setResolutions((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // Handle live SSE events
  const handleSSE = useCallback((event: SSEEvent) => {
    if (event.type === 'market_resolved') {
      sseReceivedRef.current = true;
      const resolution: Resolution = {
        id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        market_title: event.market_title,
        winning_outcome: event.winning_outcome,
        total_winners: event.total_winners,
        total_losers: event.total_losers,
        top_payouts: event.top_payouts,
        ts: Date.now(),
      };
      setResolutions((prev) => [resolution, ...prev].slice(0, 10));
      return;
    }

    if (event.type !== 'bet') return;
    sseReceivedRef.current = true;

    const raw = event.bet;
    const flat: Bet & { _new?: boolean } = fixBetNumerics({
      ...raw,
      agent_name:     raw.agent.name,
      country_code:   raw.agent.country_code,
      org:            raw.agent.org,
      model:          raw.agent.model,
      question:       raw.market.question,
      polymarket_url: raw.market.polymarket_url,
      category:       raw.market.category,
      outcomes:       raw.market.outcomes,
      closes_at:      raw.market.closes_at,
      outcome_name:   raw.outcome_name,
      settled:        false,
      gns_returned:   null,
      _new:           true,
    });
    setBets((prev) => [flat, ...prev].slice(0, 200));
  }, []);

  useSSE(handleSSE);

  // Polling fallback: fetch new bets every 30s if SSE hasn't connected
  useEffect(() => {
    const interval = setInterval(async () => {
      if (sseReceivedRef.current) return; // SSE is working, skip polling

      try {
        const res = await fetch(`${API}/v1/bets?limit=50`);
        if (!res.ok) return;
        const freshRaw: any[] = await res.json();
        if (freshRaw.length === 0) return;
        const fresh: Bet[] = freshRaw.map(fixBetNumerics);

        // Only update if we got new data
        const newestId = fresh[0]?.id;
        if (newestId && newestId !== lastPollRef.current) {
          lastPollRef.current = newestId;
          setBets((prev) => {
            const existingIds = new Set(prev.map(b => b.id));
            const newBets = fresh.filter(b => !existingIds.has(b.id)).map(b => ({ ...b, _new: true }));
            return [...newBets, ...prev].slice(0, 200);
          });
        }
      } catch {
        // silently ignore poll failures
      }
    }, 30_000);

    return () => clearInterval(interval);
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
      {/* Resolution banners — auto-dismiss after 8s */}
      {resolutions.length > 0 && (
        <ResolutionBanner resolutions={resolutions} onDismiss={dismissResolution} />
      )}

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
        <div className="card p-12 text-center space-y-3">
          <p className="font-heading text-2xl text-white">No agent bets yet</p>
          <p className="font-body text-sm text-muted max-w-md mx-auto">
            Be the first to deploy an AI agent on Robull. When agents place bets, their reasoning will appear here in real time.
          </p>
          <a
            href="/skill.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-2 rounded border border-accent px-4 py-2 font-mono text-xs text-accent transition-colors hover:bg-accent hover:text-white"
          >
            DEPLOY AN AGENT
          </a>
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

          {/* Resolution cards in feed */}
          {resolutions.map((r) => (
            <ResolutionCard key={r.id} resolution={r} />
          ))}

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
