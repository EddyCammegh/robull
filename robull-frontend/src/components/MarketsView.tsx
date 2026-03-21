'use client';

import { useState, useMemo } from 'react';
import MarketRow from './MarketRow';
import EventRow from './EventRow';
import MarketPanel from './MarketPanel';
import NewsPanel from './NewsPanel';
import { useSSE } from '@/lib/sse';
import type { Market, RobullEvent, MarketCategory, SSEEvent } from '@/types';

const DISPLAY_CATEGORIES: MarketCategory[] = ['POLITICS', 'CRYPTO', 'MACRO', 'AI/TECH'];
const ALLOWED_CATEGORIES = new Set(DISPLAY_CATEGORIES);
const SECTION_SIZE = 6;
const EXPAND_PAGE = 12;

type SelectionBadge = 'closing_soon' | 'hot' | undefined;

interface CatItem {
  kind: 'market' | 'event';
  id: string;
  closes_at: string | null;
  bet_count: number;
  volume: number;
  badge?: SelectionBadge;
  market?: Market;
  event?: RobullEvent;
}

function selectForSection(items: CatItem[]): CatItem[] {
  const now = Date.now();
  const h24 = 24 * 60 * 60 * 1000;
  const selected: CatItem[] = [];
  const used = new Set<string>();

  // 1. Closing soon (within 24h, still open), max 2
  const closingSoon = items
    .filter(i => i.closes_at && new Date(i.closes_at).getTime() - now < h24 && new Date(i.closes_at).getTime() > now)
    .sort((a, b) => new Date(a.closes_at!).getTime() - new Date(b.closes_at!).getTime());

  for (const item of closingSoon.slice(0, 2)) {
    selected.push({ ...item, badge: 'closing_soon' });
    used.add(item.id);
  }

  // 2. Most agent bets — fill up to ~half remaining slots
  const remaining = SECTION_SIZE - selected.length;
  const betSlots = Math.ceil(remaining / 2);
  const byBets = items
    .filter(i => !used.has(i.id) && i.bet_count > 0)
    .sort((a, b) => b.bet_count - a.bet_count);

  for (const item of byBets.slice(0, betSlots)) {
    selected.push({ ...item, badge: 'hot' });
    used.add(item.id);
  }

  // 3. Highest volume — fill rest
  const byVolume = items
    .filter(i => !used.has(i.id))
    .sort((a, b) => b.volume - a.volume);

  for (const item of byVolume) {
    if (selected.length >= SECTION_SIZE) break;
    selected.push({ ...item, badge: undefined });
    used.add(item.id);
  }

  return selected;
}

function toCatItems(markets: Market[], events: RobullEvent[], category: MarketCategory): CatItem[] {
  const items: CatItem[] = [];

  for (const m of markets) {
    if (m.category !== category || m.resolved || m.event_id) continue;
    items.push({ kind: 'market', id: m.id, closes_at: m.closes_at, bet_count: m.bet_count ?? 0, volume: m.volume, market: m });
  }
  for (const e of events) {
    if (e.category !== category || e.resolved) continue;
    items.push({ kind: 'event', id: e.id, closes_at: e.closes_at, bet_count: e.bet_count ?? 0, volume: e.volume, event: e });
  }

  return items;
}

interface MarketsViewProps {
  markets: Market[];
  events?: RobullEvent[];
}

export default function MarketsView({ markets, events = [] }: MarketsViewProps) {
  const [search, setSearch] = useState('');
  const [expandedCats, setExpandedCats] = useState<Record<string, number>>({});
  const [liveProbs, setLiveProbs] = useState<Record<string, number[]>>({});

  useSSE((event: SSEEvent) => {
    if (event.type === 'odds') {
      setLiveProbs((prev) => ({ ...prev, [event.marketId]: event.probs }));
    }
  });

  const toggleExpand = (cat: MarketCategory) => {
    setExpandedCats((prev) => {
      if (prev[cat]) {
        const next = { ...prev };
        delete next[cat];
        return next;
      }
      return { ...prev, [cat]: EXPAND_PAGE };
    });
  };

  const showMore = (cat: MarketCategory) => {
    setExpandedCats((prev) => ({ ...prev, [cat]: (prev[cat] ?? EXPAND_PAGE) + EXPAND_PAGE }));
  };

  // Build per-category data
  const categoryData = useMemo(() => {
    const kw = search.toLowerCase();

    return DISPLAY_CATEGORIES.map((cat) => {
      let allItems = toCatItems(markets, events, cat);

      // Apply search filter
      if (kw) {
        allItems = allItems.filter((item) => {
          if (item.kind === 'market') return item.market!.question.toLowerCase().includes(kw);
          return item.event!.title.toLowerCase().includes(kw);
        });
      }

      const featured = selectForSection(allItems);
      return { category: cat, allItems, featured };
    });
  }, [markets, events, search]);

  // Resolved markets
  const resolved = useMemo(() => {
    return markets
      .filter(m => ALLOWED_CATEGORIES.has(m.category) && m.resolved && m.winning_outcome != null)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 20);
  }, [markets]);

  const totalActive = categoryData.reduce((sum, c) => sum + c.allItems.length, 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 lg:grid lg:grid-cols-[1fr_300px] lg:gap-6">
      <div>
        <div className="mb-6 flex items-baseline gap-3">
          <h1 className="font-heading text-4xl text-white">PREDICTION MARKETS</h1>
          <span className="font-mono text-sm text-muted">{totalActive} active</span>
        </div>

        {/* Search */}
        <div className="mb-8">
          <input
            type="text"
            placeholder="Search markets and events..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md rounded bg-surface border border-border px-3 py-2 font-mono text-xs text-white placeholder-muted focus:border-accent focus:outline-none transition-colors"
          />
        </div>

        {/* Category sections */}
        {categoryData.map(({ category, allItems, featured }) => {
          if (allItems.length === 0) return null;
          const expandedCount = expandedCats[category];
          const isExpanded = !!expandedCount;

          // Items to show in expanded view (paginated)
          const expandedItems = isExpanded ? allItems.slice(0, expandedCount) : [];
          const hasMoreExpanded = isExpanded && expandedCount < allItems.length;

          return (
            <section key={category} className="mb-10">
              {/* Section header */}
              <div className="mb-3 flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="font-mono text-[10px] text-muted font-bold tracking-widest">
                  {category} ({allItems.length})
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* Featured 3x2 grid (or expanded list view) */}
              {!isExpanded ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {featured.map((item) => (
                      <MarketPanel
                        key={item.id}
                        kind={item.kind}
                        market={item.market}
                        event={item.event}
                        badge={item.badge}
                        liveProbs={liveProbs[item.id]}
                      />
                    ))}
                  </div>

                  {/* View all link */}
                  {allItems.length > SECTION_SIZE && (
                    <button
                      onClick={() => toggleExpand(category)}
                      className="mt-3 w-full text-center font-mono text-xs text-accent hover:text-accent-dim transition-colors"
                    >
                      View all {allItems.length} {category} markets &rarr;
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {expandedItems.map((item) => (
                      <MarketPanel
                        key={item.id}
                        kind={item.kind}
                        market={item.market}
                        event={item.event}
                        liveProbs={liveProbs[item.id]}
                      />
                    ))}
                  </div>

                  <div className="mt-3 flex items-center justify-center gap-4">
                    {hasMoreExpanded && (
                      <button
                        onClick={() => showMore(category)}
                        className="font-mono text-xs text-accent hover:text-accent-dim transition-colors"
                      >
                        Show more ({allItems.length - expandedCount} remaining)
                      </button>
                    )}
                    <button
                      onClick={() => toggleExpand(category)}
                      className="font-mono text-xs text-muted hover:text-accent transition-colors"
                    >
                      Collapse
                    </button>
                  </div>
                </>
              )}
            </section>
          );
        })}

        {totalActive === 0 && (
          <div className="card p-8 text-center">
            <p className="font-mono text-sm text-muted">No markets match your search.</p>
          </div>
        )}

        {/* Recently resolved */}
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

        <p className="mt-6 font-mono text-[10px] text-muted text-center">
          {markets.length} markets + {events.length} events synced from Polymarket
        </p>
      </div>

      {/* News sidebar */}
      <div className="mt-6 lg:mt-0 lg:sticky lg:top-4 lg:self-start">
        <NewsPanel />
      </div>
    </div>
  );
}
