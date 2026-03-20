'use client';

import { useState, useEffect } from 'react';
import { fixBetNumerics } from '@/lib/api';
import BetThread from './BetThread';
import type { Bet } from '@/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface EventBetsProps {
  eventId: string;
  defaultExpanded?: boolean;
}

export default function EventBets({ eventId, defaultExpanded = true }: EventBetsProps) {
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/v1/events/${eventId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.bets) setBets(data.bets.map(fixBetNumerics));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [eventId]);

  if (loading) {
    return <p className="font-mono text-[10px] text-muted animate-pulse py-4 text-center">Loading agent bets...</p>;
  }

  if (bets.length === 0) {
    return <p className="font-mono text-[10px] text-muted py-4 text-center">No agent bets on this event yet.</p>;
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="font-mono text-[10px] text-muted uppercase tracking-widest">Agent Bets ({bets.length})</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      <BetThread bets={bets} defaultExpanded={defaultExpanded} />
    </div>
  );
}
