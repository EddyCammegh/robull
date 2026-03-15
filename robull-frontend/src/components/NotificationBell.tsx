'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useSSE } from '@/lib/sse';
import { useMarketClick } from './MarketClickProvider';
import type { SSEEvent, Bet, Market } from '@/types';

interface Notification {
  id: string;
  type: 'closing_soon' | 'new_market' | 'split' | 'big_bet';
  title: string;
  body: string;
  ts: string;
  read: boolean;
  marketId?: string;
}

interface NotificationBellProps {
  markets: Market[];
  bets: Bet[];
}

export default function NotificationBell({ markets, bets }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const seenRef = useRef(new Set<string>());
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { openMarket } = useMarketClick();

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const addNotification = useCallback((n: Omit<Notification, 'read'>) => {
    if (seenRef.current.has(n.id)) return;
    seenRef.current.add(n.id);
    setNotifications(prev => [{ ...n, read: false }, ...prev].slice(0, 20));
  }, []);

  // Generate notifications from market data on mount and periodically
  useEffect(() => {
    function check() {
      const now = Date.now();

      // Markets closing within 1 hour
      for (const m of markets) {
        if (!m.closes_at || m.resolved) continue;
        const timeLeft = new Date(m.closes_at).getTime() - now;
        if (timeLeft > 0 && timeLeft <= 60 * 60 * 1000) {
          addNotification({
            id: `closing-${m.id}`,
            type: 'closing_soon',
            title: 'Market closing soon',
            body: m.question.slice(0, 80) + (m.question.length > 80 ? '...' : ''),
            ts: new Date().toISOString(),
            marketId: m.id,
          });
        }
      }

      // Markets with heavy splits (3+ agents on opposing sides)
      const marketBets: Record<string, { outcomes: Record<number, number>; question: string }> = {};
      for (const b of bets) {
        if (!marketBets[b.market_id]) marketBets[b.market_id] = { outcomes: {}, question: b.question ?? '' };
        marketBets[b.market_id].outcomes[b.outcome_index] = (marketBets[b.market_id].outcomes[b.outcome_index] ?? 0) + 1;
      }
      for (const [mid, data] of Object.entries(marketBets)) {
        const counts = Object.values(data.outcomes);
        if (counts.length >= 2 && counts.filter(c => c >= 3).length >= 2) {
          addNotification({
            id: `split-${mid}`,
            type: 'split',
            title: 'Agents heavily split',
            body: data.question.slice(0, 80) + (data.question.length > 80 ? '...' : ''),
            ts: new Date().toISOString(),
            marketId: mid,
          });
        }
      }
    }

    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [markets, bets, addNotification]);

  // Listen for live SSE events
  useSSE(useCallback((event: SSEEvent) => {
    if (event.type !== 'bet') return;
    const raw = event.bet;

    // Big bet by any agent (2000+ GNS)
    if (raw.gns_wagered >= 2000) {
      addNotification({
        id: `bigbet-${raw.id}`,
        type: 'big_bet',
        title: 'Large bet placed',
        body: `${raw.agent.name} wagered ${raw.gns_wagered.toLocaleString()} GNS on "${raw.market.question.slice(0, 60)}..."`,
        ts: new Date().toISOString(),
        marketId: raw.market_id,
      });
    }
  }, [addNotification]));

  const unread = notifications.filter(n => !n.read).length;

  function markAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }

  const ICON_MAP: Record<string, string> = {
    closing_soon: 'o',
    new_market: '+',
    split: '!',
    big_bet: '$',
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => { setOpen(!open); if (!open) markAllRead(); }}
        className="relative rounded px-2 py-1.5 text-muted hover:text-white transition-colors"
        title="Notifications"
      >
        {/* Bell icon (SVG) */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 font-mono text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 card overflow-hidden shadow-2xl z-50">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="font-mono text-[10px] text-muted uppercase tracking-widest">Notifications</span>
            {notifications.length > 0 && (
              <button onClick={markAllRead} className="font-mono text-[10px] text-accent hover:text-accent-dim">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="p-4 font-mono text-xs text-muted text-center">No notifications yet</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (n.marketId) { openMarket(n.marketId); setOpen(false); }
                  }}
                  className={`w-full flex gap-2 px-3 py-2.5 border-b border-border last:border-0 text-left transition-colors hover:bg-subtle/40 ${n.marketId ? 'cursor-pointer' : ''} ${!n.read ? 'bg-accent/5' : ''}`}
                >
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-surface border border-border flex items-center justify-center font-mono text-[10px] text-accent">
                    {ICON_MAP[n.type] ?? '?'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] font-semibold text-white">{n.title}</p>
                    <p className="font-body text-[11px] text-gray-400 leading-snug truncate">{n.body}</p>
                    <p className="font-mono text-[9px] text-muted mt-0.5">
                      {formatDistanceToNow(new Date(n.ts), { addSuffix: true })}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
