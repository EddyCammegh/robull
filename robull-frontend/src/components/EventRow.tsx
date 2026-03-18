'use client';

import { useState } from 'react';
import clsx from 'clsx';
import CountdownTimer from './CountdownTimer';
import PolymarketButton from './PolymarketButton';
import type { RobullEvent, MarketCategory } from '@/types';

const CATEGORY_CLASS: Record<MarketCategory, string> = {
  MACRO:         'cat-MACRO',
  POLITICS:      'cat-POLITICS',
  CRYPTO:        'cat-CRYPTO',
  SPORTS:        'cat-SPORTS',
  'AI/TECH':     'cat-AITECH',
  ENTERTAINMENT: 'cat-ENTERTAINMENT',
  OTHER:         'cat-OTHER',
};

const INITIAL_VISIBLE = 8;

export default function EventRow({ event }: { event: RobullEvent }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const category = event.category as MarketCategory;

  // Sort outcomes by probability descending
  const sorted = [...event.outcomes].sort((a, b) => b.probability - a.probability);
  const shown = showAll ? sorted : sorted.slice(0, INITIAL_VISIBLE);
  const hiddenCount = sorted.length - INITIAL_VISIBLE;

  // Find the highest probability for the bar width scale
  const maxProb = sorted.length > 0 ? sorted[0].probability : 1;

  return (
    <div className="card overflow-hidden">
      <button
        className="w-full px-4 py-3 text-left transition-colors hover:bg-subtle/30"
        onClick={() => setOpen(!open)}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="rounded bg-accent/20 border border-accent/50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-accent flex-shrink-0">
              {event.outcomes.length} OUTCOMES
            </span>
            <span
              className={clsx(
                'rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase flex-shrink-0',
                CATEGORY_CLASS[category]
              )}
            >
              {category}
            </span>
            <span className="font-body text-sm text-white font-medium truncate">
              {event.title}
            </span>
          </div>

          <div className="flex items-center gap-4 flex-shrink-0">
            {event.bet_count > 0 && (
              <span className="font-mono text-xs text-muted hidden sm:block">
                {event.bet_count} bets
              </span>
            )}
            <CountdownTimer closesAt={event.closes_at} resolved={event.resolved} className="hidden sm:block" />
            <span className="font-mono text-xs text-muted hidden sm:block">
              ${(event.volume / 1000).toFixed(0)}K vol
            </span>
            <span className="font-mono text-xs text-muted">{open ? '▲' : '▼'}</span>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 animate-slideUp">
          {/* Outcome probability bars */}
          <div className="space-y-1.5 mb-4">
            {shown.map((outcome, i) => (
              <div key={outcome.market_id} className="flex items-center gap-3">
                <span className="font-mono text-xs text-white w-12 text-right font-semibold flex-shrink-0">
                  {(outcome.probability * 100).toFixed(1)}%
                </span>
                <div className="flex-1 h-4 rounded bg-subtle overflow-hidden relative">
                  <div
                    className="h-full rounded transition-all duration-500"
                    style={{
                      width: `${Math.max((outcome.probability / Math.max(maxProb, 0.01)) * 100, 1)}%`,
                      background: i === 0 ? '#ff4400' : i === 1 ? '#cc3600' : '#555555',
                    }}
                  />
                  <span className="absolute inset-0 flex items-center px-2 font-mono text-[10px] text-white font-medium truncate">
                    {outcome.label}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-muted flex-shrink-0 w-14 text-right hidden sm:block">
                  ${(outcome.volume / 1000).toFixed(0)}K
                </span>
              </div>
            ))}
          </div>

          {/* Show more toggle */}
          {hiddenCount > 0 && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="mb-4 w-full rounded border border-border py-1.5 font-mono text-[10px] text-muted hover:border-accent hover:text-accent transition-colors"
            >
              SHOW {hiddenCount} MORE OUTCOMES
            </button>
          )}
          {showAll && hiddenCount > 0 && (
            <button
              onClick={() => setShowAll(false)}
              className="mb-4 w-full rounded border border-border py-1.5 font-mono text-[10px] text-muted hover:border-accent hover:text-accent transition-colors"
            >
              SHOW LESS
            </button>
          )}

          {/* Polymarket button */}
          <PolymarketButton url={event.polymarket_url} question={event.title} />
        </div>
      )}
    </div>
  );
}
