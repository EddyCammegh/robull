'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { api } from '@/lib/api';
import PolymarketButton from './PolymarketButton';
import type { RobullEvent } from '@/types';

interface Article {
  title: string;
  url: string;
  source: string;
  published_at: string;
}

interface PriceData {
  crypto: { symbol: string; price_usd: number }[];
  fx: { pair: string; rate: number }[];
}

const CARD_LABELS = ['NEWS', 'PRICES', 'DATA'];
const AUTO_ADVANCE_MS = 5000;

export default function EventInfoCarousel({ event }: { event: RobullEvent }) {
  const [activeCard, setActiveCard] = useState(0);
  const [articles, setArticles] = useState<Article[]>([]);
  const [prices, setPrices] = useState<PriceData | null>(null);
  const [fetched, setFetched] = useState(false);
  const pausedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showPrices = event.category === 'CRYPTO' || event.category === 'MACRO';
  const cards = showPrices ? CARD_LABELS : ['NEWS', 'DATA'];

  // Fetch data once
  useEffect(() => {
    if (fetched) return;
    setFetched(true);
    api.news.forEvent(event.id).then((data) => {
      setArticles(data.articles?.slice(0, 5) ?? []);
      if (data.prices) setPrices(data.prices);
    }).catch(() => {});
  }, [event.id, fetched]);

  // Refresh prices every 60s
  useEffect(() => {
    if (!showPrices) return;
    const interval = setInterval(() => {
      api.prices.get().then(setPrices).catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, [showPrices]);

  // Auto-advance
  useEffect(() => {
    timerRef.current = setInterval(() => {
      if (!pausedRef.current) {
        setActiveCard((prev) => (prev + 1) % cards.length);
      }
    }, AUTO_ADVANCE_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [cards.length]);

  const pause = useCallback(() => { pausedRef.current = true; }, []);
  const resume = useCallback(() => { pausedRef.current = false; }, []);

  const currentLabel = cards[activeCard] ?? 'NEWS';

  return (
    <div
      className="rounded border border-border bg-surface/30 overflow-hidden"
      onMouseEnter={pause}
      onMouseLeave={resume}
    >
      {/* Dots navigation */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="font-mono text-[9px] text-muted uppercase tracking-widest">{currentLabel}</span>
        <div className="flex items-center gap-1.5">
          {cards.map((label, i) => (
            <button
              key={label}
              onClick={() => setActiveCard(i)}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === activeCard ? 'bg-accent' : 'bg-border hover:bg-muted'
              }`}
              title={label}
            />
          ))}
        </div>
      </div>

      {/* Card content */}
      <div className="px-3 py-2 min-h-[100px]">
        {currentLabel === 'NEWS' && <NewsCard articles={articles} />}
        {currentLabel === 'PRICES' && <PricesCard prices={prices} />}
        {currentLabel === 'DATA' && <DataCard event={event} />}
      </div>
    </div>
  );
}

function NewsCard({ articles }: { articles: Article[] }) {
  if (articles.length === 0) {
    return <p className="font-mono text-[10px] text-muted text-center py-4">No relevant news found</p>;
  }
  return (
    <div className="space-y-0.5">
      {articles.map((a, i) => (
        <a
          key={i}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-2 rounded px-1 py-1 transition-colors hover:bg-subtle/40 group"
        >
          <span className="font-mono text-[8px] text-muted flex-shrink-0 w-14 pt-0.5 uppercase">
            {a.source}
          </span>
          <span className="font-body text-[11px] text-gray-300 group-hover:text-white leading-snug line-clamp-1 flex-1">
            {a.title}
          </span>
          <span className="font-mono text-[8px] text-muted flex-shrink-0 pt-0.5">
            {(() => { try { return formatDistanceToNow(new Date(a.published_at), { addSuffix: false }); } catch { return ''; } })()}
          </span>
        </a>
      ))}
    </div>
  );
}

function PricesCard({ prices }: { prices: PriceData | null }) {
  if (!prices) {
    return <p className="font-mono text-[10px] text-muted text-center py-4">Loading prices...</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 py-1">
      {prices.crypto.map((c) => (
        <div key={c.symbol} className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-muted">{c.symbol}</span>
          <span className="font-mono text-xs text-white font-semibold">
            ${c.price_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>
      ))}
      {prices.fx.map((f) => (
        <div key={f.pair} className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-muted">{f.pair}</span>
          <span className="font-mono text-xs text-white font-semibold">
            {f.rate.toFixed(f.pair.includes('JPY') || f.pair.includes('CNY') ? 2 : 4)}
          </span>
        </div>
      ))}
    </div>
  );
}

function DataCard({ event }: { event: RobullEvent }) {
  const activeCount = event.outcomes.filter((o) => !o.passed).length;
  const passedCount = event.outcomes.filter((o) => o.passed).length;

  return (
    <div className="space-y-2 py-1">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        <div className="flex justify-between">
          <span className="font-mono text-[10px] text-muted">Volume</span>
          <span className="font-mono text-xs text-white">${(event.volume / 1000).toFixed(0)}K</span>
        </div>
        <div className="flex justify-between">
          <span className="font-mono text-[10px] text-muted">Outcomes</span>
          <span className="font-mono text-xs text-white">
            {activeCount} active{passedCount > 0 ? ` · ${passedCount} passed` : ''}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="font-mono text-[10px] text-muted">Agents</span>
          <span className="font-mono text-xs text-white">{event.active_agent_count}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-mono text-[10px] text-muted">Bets</span>
          <span className="font-mono text-xs text-white">{event.bet_count}</span>
        </div>
      </div>
      <PolymarketButton url={event.polymarket_url} question={event.title} />
    </div>
  );
}
