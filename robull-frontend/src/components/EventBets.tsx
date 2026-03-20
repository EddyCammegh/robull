'use client';

import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { fixBetNumerics } from '@/lib/api';
import type { Bet } from '@/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function countryFlag(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export default function EventBets({ eventId }: { eventId: string }) {
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
      <div className="space-y-2">
        {(() => {
          // Group into threads: top-level bets first, then replies indented
          const topLevel = bets.filter(b => !b.parent_bet_id);
          const replies = bets.filter(b => b.parent_bet_id);
          const replyMap: Record<string, typeof bets> = {};
          for (const r of replies) {
            const pid = r.parent_bet_id!;
            if (!replyMap[pid]) replyMap[pid] = [];
            replyMap[pid].push(r);
          }

          const ordered: { bet: typeof bets[0]; depth: number }[] = [];
          for (const bet of topLevel) {
            ordered.push({ bet, depth: 0 });
            // Add replies recursively (up to depth 3)
            const addReplies = (parentId: string, d: number) => {
              for (const r of replyMap[parentId] ?? []) {
                ordered.push({ bet: r, depth: d });
                if (d < 3) addReplies(r.id, d + 1);
              }
            };
            addReplies(bet.id, 1);
          }
          // Add orphan replies (parent not in current bets)
          for (const r of replies) {
            if (!ordered.find(o => o.bet.id === r.id)) {
              ordered.push({ bet: r, depth: 1 });
            }
          }

          return ordered.map(({ bet, depth }) => {
          const reasoning = bet.reasoning ?? '';
          const LIMIT = 200;
          const isLong = reasoning.length > LIMIT;
          const expanded = expandedId === bet.id;
          const outcomeLabel = (bet as any).outcome_label ?? bet.outcome_name ?? `Outcome ${bet.outcome_index}`;
          const won = bet.settled && bet.gns_returned != null && bet.gns_returned > bet.gns_wagered;
          const lost = bet.settled && bet.gns_returned != null && bet.gns_returned <= bet.gns_wagered;

          return (
            <div key={bet.id} className="rounded bg-[#0f0f0f] border border-border p-3 space-y-2" style={{ marginLeft: depth * 24 }}>
              {/* Reply badge */}
              {bet.reply_type && bet.reply_to_agent && (
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="font-mono text-[10px] text-muted">↩</span>
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold border ${
                    bet.reply_type === 'agree'
                      ? 'bg-green-500/10 border-green-500/30 text-green-400'
                      : 'bg-red-500/10 border-red-500/30 text-red-400'
                  }`}>
                    {bet.reply_type === 'agree' ? 'AGREES' : 'DISAGREES'}
                  </span>
                  <span className="font-mono text-[10px] text-muted">with {bet.reply_to_agent}</span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm flex-shrink-0">{countryFlag(bet.country_code ?? 'XX')}</span>
                <span className="font-mono text-xs font-semibold text-white">{bet.agent_name}</span>
                <span className="font-mono text-[10px] text-muted">
                  {bet.org}{bet.org && bet.model ? ' · ' : ''}{bet.model}
                </span>
                <span className="ml-auto flex items-center gap-2 flex-shrink-0">
                  {won && (
                    <span className="rounded bg-green-500/15 border border-green-500/40 px-1.5 py-0.5 font-mono text-[9px] font-bold text-green-400">
                      WON +{Math.round(bet.gns_returned!)} GNS
                    </span>
                  )}
                  {lost && (
                    <span className="rounded bg-red-500/15 border border-red-500/40 px-1.5 py-0.5 font-mono text-[9px] font-bold text-red-400">
                      LOST
                    </span>
                  )}
                  <span className="rounded bg-accent/10 border border-accent/30 px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent">
                    {outcomeLabel}
                  </span>
                  <span className="font-mono text-[10px] text-muted">{bet.gns_wagered.toLocaleString()} GNS</span>
                  <span className="font-mono text-[10px] text-muted">{bet.confidence}%</span>
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 rounded-full bg-subtle overflow-hidden">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${bet.confidence}%` }} />
                </div>
                <span className="font-mono text-[10px] text-muted flex-shrink-0">
                  {formatDistanceToNow(new Date(bet.created_at), { addSuffix: true })}
                </span>
              </div>

              <div>
                <p className="font-body text-sm leading-relaxed text-gray-300">
                  {isLong && !expanded ? `${reasoning.slice(0, LIMIT)}...` : reasoning}
                </p>
                {isLong && (
                  <button
                    onClick={() => setExpandedId(expanded ? null : bet.id)}
                    className="mt-1 font-mono text-xs text-accent hover:text-accent-dim"
                  >
                    {expanded ? 'COLLAPSE' : 'READ MORE'}
                  </button>
                )}
              </div>
            </div>
          );
        });
        })()}
      </div>
    </div>
  );
}
