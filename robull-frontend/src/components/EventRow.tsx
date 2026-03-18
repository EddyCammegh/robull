'use client';

import { useState } from 'react';
import clsx from 'clsx';
import CountdownTimer from './CountdownTimer';
import PolymarketButton from './PolymarketButton';
import type { RobullEvent, EventOutcome, MarketCategory } from '@/types';

const CATEGORY_CLASS: Record<MarketCategory, string> = {
  MACRO:         'cat-MACRO',
  POLITICS:      'cat-POLITICS',
  CRYPTO:        'cat-CRYPTO',
  SPORTS:        'cat-SPORTS',
  'AI/TECH':     'cat-AITECH',
  ENTERTAINMENT: 'cat-ENTERTAINMENT',
  OTHER:         'cat-OTHER',
};

const INITIAL_VISIBLE = 12;
const LOAD_MORE_STEP = 20;

export default function EventRow({ event }: { event: RobullEvent }) {
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const category = event.category as MarketCategory;

  // Sort outcomes by probability descending
  const sorted = [...event.outcomes].sort((a, b) => b.probability - a.probability);
  const shown = sorted.slice(0, visibleCount);
  const hiddenCount = sorted.length - visibleCount;

  // Detect event type: mutually exclusive (sum ~100%) vs independent thresholds (sum >110%)
  const probSum = event.outcomes.reduce((s, o) => s + o.probability, 0);
  const isIndependent = probSum > 1.1;

  // For mutually exclusive: scale bars relative to leader
  // For independent: scale bars to 100% = 100% probability (absolute)
  const maxProb = sorted.length > 0 ? sorted[0].probability : 1;

  const typeBadge = isIndependent ? 'INDEPENDENT' : 'PICK ONE';

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
          {/* Type indicator */}
          <div className="mb-3 flex items-center gap-2">
            <span className={clsx(
              'rounded px-1.5 py-0.5 font-mono text-[9px] font-bold border',
              isIndependent
                ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                : 'bg-green-500/10 border-green-500/30 text-green-400'
            )}>
              {typeBadge}
            </span>
            <span className="font-mono text-[10px] text-muted">
              {isIndependent
                ? 'Each outcome resolves independently — multiple can be true'
                : 'Only one outcome wins'}
            </span>
          </div>

          {/* Outcome probability bars */}
          <div className="space-y-1.5 mb-4">
            {shown.map((outcome, i) => (
              <OutcomeBar
                key={outcome.market_id}
                outcome={outcome}
                index={i}
                isIndependent={isIndependent}
                maxProb={maxProb}
              />
            ))}
          </div>

          {/* Show more / collapse */}
          {hiddenCount > 0 && (
            <button
              onClick={() => setVisibleCount(v => Math.min(v + LOAD_MORE_STEP, sorted.length))}
              className="mb-4 w-full rounded border border-border py-1.5 font-mono text-[10px] text-muted hover:border-accent hover:text-accent transition-colors"
            >
              SHOW {Math.min(hiddenCount, LOAD_MORE_STEP)} MORE ({hiddenCount} remaining)
            </button>
          )}
          {visibleCount > INITIAL_VISIBLE && (
            <button
              onClick={() => setVisibleCount(INITIAL_VISIBLE)}
              className="mb-4 w-full rounded border border-border py-1.5 font-mono text-[10px] text-muted hover:border-accent hover:text-accent transition-colors"
            >
              COLLAPSE
            </button>
          )}

          {/* Polymarket button */}
          <PolymarketButton url={event.polymarket_url} question={event.title} />
        </div>
      )}
    </div>
  );
}

function OutcomeBar({ outcome, index, isIndependent, maxProb }: {
  outcome: EventOutcome; index: number; isIndependent: boolean; maxProb: number;
}) {
  // Independent: absolute width (probability = % of bar filled)
  // Mutually exclusive: relative to leader
  const barWidth = isIndependent
    ? `${outcome.probability * 100}%`
    : maxProb > 0 ? `${(outcome.probability / maxProb) * 100}%` : '0%';

  const barColor = isIndependent
    ? '#60a5fa' // blue for independent thresholds
    : index === 0 ? '#ff4400' : index === 1 ? '#cc3600' : '#555555';

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-xs text-white w-12 text-right font-semibold flex-shrink-0">
        {(outcome.probability * 100).toFixed(1)}%
      </span>
      <div className="flex-1 h-4 rounded bg-subtle overflow-hidden relative">
        <div
          className="h-full rounded transition-all duration-500"
          style={{ width: barWidth, background: barColor }}
        />
        <span className="absolute inset-0 flex items-center px-2 font-mono text-[10px] text-white font-medium truncate">
          {outcome.label}
        </span>
      </div>
      <span className="font-mono text-[10px] text-muted flex-shrink-0 w-14 text-right hidden sm:block">
        ${(outcome.volume / 1000).toFixed(0)}K
      </span>
    </div>
  );
}
