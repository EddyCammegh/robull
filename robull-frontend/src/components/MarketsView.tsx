'use client';

import { useState, useMemo } from 'react';
import clsx from 'clsx';
import MarketRow from './MarketRow';
import EventRow from './EventRow';
import { useSSE } from '@/lib/sse';
import type { Market, RobullEvent, SSEEvent } from '@/types';

const CATEGORIES = ['ALL', 'POLITICS', 'CRYPTO', 'MACRO', 'AI/TECH'];
// Only these categories are displayed — SPORTS, ENTERTAINMENT, OTHER excluded
const ALLOWED_CATEGORIES = new Set(['POLITICS', 'CRYPTO', 'MACRO', 'AI/TECH']);
const PAGE_SIZE = 50;

type SortKey = 'ending_soon' | 'ending_late' | 'most_active' | 'highest_vol' | 'most_contested';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'ending_soon',    label: 'Ending soonest'  },
  { key: 'ending_late',    label: 'Ending latest'   },
  { key: 'most_active',    label: 'Most active'     },
  { key: 'highest_vol',    label: 'Highest volume'  },
  { key: 'most_contested', label: 'Most contested'  },
];

function sortMarkets(markets: Market[], key: SortKey): Market[] {
  const sorted = [...markets];
  switch (key) {
    case 'ending_soon':
      return sorted.sort((a, b) => {
        if (!a.closes_at && !b.closes_at) return 0;
        if (!a.closes_at) return 1;
        if (!b.closes_at) return -1;
        return new Date(a.closes_at).getTime() - new Date(b.closes_at).getTime();
      });
    case 'ending_late':
      return sorted.sort((a, b) => {
        if (!a.closes_at && !b.closes_at) return 0;
        if (!a.closes_at) return -1;
        if (!b.closes_at) return 1;
        return new Date(b.closes_at).getTime() - new Date(a.closes_at).getTime();
      });
    case 'most_active':
      return sorted.sort((a, b) => (b.bet_count ?? 0) - (a.bet_count ?? 0));
    case 'highest_vol':
      return sorted.sort((a, b) => b.volume - a.volume);
    case 'most_contested':
      return sorted.sort((a, b) => {
        if (a.split !== b.split) return a.split ? -1 : 1;
        return (b.bet_count ?? 0) - (a.bet_count ?? 0);
      });
    default:
      return sorted;
  }
}

interface MarketsViewProps {
  markets: Market[];
  events?: RobullEvent[];
}

export default function MarketsView({ markets, events = [] }: MarketsViewProps) {
  const [category,   setCategory]   = useState('');
  const [search,     setSearch]     = useState('');
  const [sortKey,    setSortKey]    = useState<SortKey>('ending_soon');
  const [visible,    setVisible]    = useState(PAGE_SIZE);
  const [liveProbs,  setLiveProbs]  = useState<Record<string, number[]>>({});

  useSSE((event: SSEEvent) => {
    if (event.type === 'odds') {
      setLiveProbs((prev) => ({ ...prev, [event.marketId]: event.probs }));
    }
  });

  // Filter events
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (e.resolved) return false;
      if (!ALLOWED_CATEGORIES.has(e.category)) return false;
      if ((e.active_outcomes ?? e.outcomes.length) < 1) return false;
      if (category && e.category !== category) return false;
      if (search) {
        const kw = search.toLowerCase();
        if (!e.title.toLowerCase().includes(kw)) return false;
      }
      return true;
    }).sort((a, b) => {
      if (sortKey === 'highest_vol') return b.volume - a.volume;
      if (sortKey === 'most_active') return b.bet_count - a.bet_count;
      if (sortKey === 'ending_late') {
        if (!a.closes_at && !b.closes_at) return 0;
        if (!a.closes_at) return -1;
        if (!b.closes_at) return 1;
        return new Date(b.closes_at).getTime() - new Date(a.closes_at).getTime();
      }
      // Default: ending soonest
      if (!a.closes_at && !b.closes_at) return 0;
      if (!a.closes_at) return 1;
      if (!b.closes_at) return -1;
      return new Date(a.closes_at).getTime() - new Date(b.closes_at).getTime();
    });
  }, [events, category, search, sortKey]);

  const { active, resolved } = useMemo(() => {
    const base = markets.filter((m) => {
      if (!ALLOWED_CATEGORIES.has(m.category)) return false;
      if (category && m.category !== category) return false;
      if (search) {
        const kw = search.toLowerCase();
        return m.question.toLowerCase().includes(kw);
      }
      return true;
    });
    const act = sortMarkets(base.filter(m => !m.resolved && m.winning_outcome == null && !m.event_id), sortKey);
    const res = base
      .filter(m => m.resolved && m.winning_outcome != null)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 20);
    return { active: act, resolved: res };
  }, [markets, category, search, sortKey]);

  const totalActive = active.length + filteredEvents.length;
  const shown = active.slice(0, visible);
  const hasMore = visible < active.length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="font-heading text-4xl text-white">MARKETS</h1>
        <span className="font-mono text-sm text-muted">{totalActive} active</span>
        {resolved.length > 0 && (
          <span className="font-mono text-sm text-muted">· {resolved.length} resolved</span>
        )}
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

      {/* Sort + Search row */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select
          value={sortKey}
          onChange={(e) => { setSortKey(e.target.value as SortKey); setVisible(PAGE_SIZE); }}
          className="rounded bg-surface border border-border px-3 py-2 font-mono text-xs text-white focus:border-accent focus:outline-none transition-colors cursor-pointer appearance-none"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23555'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: '28px' }}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search markets and events…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setVisible(PAGE_SIZE); }}
          className="flex-1 min-w-[200px] rounded bg-surface border border-border px-3 py-2 font-mono text-xs text-white placeholder-muted focus:border-accent focus:outline-none transition-colors"
        />
      </div>

      {totalActive === 0 && resolved.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-mono text-sm text-muted">No markets match your filters.</p>
        </div>
      ) : (
        <>
          {/* Multi-outcome events */}
          {filteredEvents.length > 0 && (
            <>
              <div className="mb-3 flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="font-mono text-[10px] text-muted font-bold tracking-widest">EVENTS ({filteredEvents.length})</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="space-y-2 mb-6">
                {filteredEvents.map((evt) => (
                  <EventRow key={evt.id} event={evt} />
                ))}
              </div>
            </>
          )}

          {/* Binary markets */}
          {active.length > 0 && (
            <>
              {filteredEvents.length > 0 && (
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex-1 h-px bg-border" />
                  <span className="font-mono text-[10px] text-muted font-bold tracking-widest">BINARY MARKETS ({active.length})</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}
              <div className="space-y-2">
                {shown.map((market) => (
                  <MarketRow
                    key={market.id}
                    market={market}
                    liveProbs={liveProbs[market.id]}
                  />
                ))}
              </div>
            </>
          )}

          {hasMore && (
            <button
              onClick={() => setVisible((v) => v + PAGE_SIZE)}
              className="mt-4 w-full rounded border border-border py-2 font-mono text-xs text-muted hover:border-accent hover:text-accent transition-colors"
            >
              SHOW MORE ({active.length - visible} remaining)
            </button>
          )}

          {/* Recently resolved markets */}
          {resolved.length > 0 && (
            <>
              <div className="mt-8 mb-4 flex items-center gap-3">
                <div className="flex-1 h-px bg-accent/30" />
                <span className="font-mono text-xs text-accent font-bold tracking-widest">RECENTLY RESOLVED</span>
                <div className="flex-1 h-px bg-accent/30" />
              </div>
              <div className="space-y-2 opacity-70">
                {resolved.map((market) => (
                  <MarketRow
                    key={market.id}
                    market={market}
                    liveProbs={liveProbs[market.id]}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      <p className="mt-6 font-mono text-[10px] text-muted text-center">
        {markets.length} markets + {events.length} events synced from Polymarket
      </p>
    </div>
  );
}
