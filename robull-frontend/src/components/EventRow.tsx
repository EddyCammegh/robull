'use client';

import { useState, useEffect } from 'react';
import clsx from 'clsx';
import CountdownTimer from './CountdownTimer';
import EventPrices from './EventPrices';
import EventBets from './EventBets';
import { api } from '@/lib/api';
import { getChartType, type ChartType } from '@/lib/chartDecision';
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
const LIST_TOP_N = 8;

export default function EventRow({ event, badge }: { event: RobullEvent; badge?: 'closing_soon' | 'hot' }) {
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [chartType, setChartType] = useState<ChartType>('bar');
  const category = event.category as MarketCategory;

  // Fetch price history on first expand to determine chart type
  useEffect(() => {
    if (!open) return;
    api.priceHistory.get({ event_id: event.id, hours: 168 }).then((data) => {
      const decision = getChartType(event, Object.keys(data).length > 0 ? data : null);
      setChartType(decision.type);
    }).catch(() => {
      setChartType(getChartType(event, null).type);
    });
  }, [open, event.id]);

  const sorted = [...event.outcomes].sort((a, b) => {
    const aExp = a.passed ? 1 : 0;
    const bExp = b.passed ? 1 : 0;
    if (aExp !== bExp) return aExp - bExp;
    if ((event.event_type === 'independent') && a.closes_at && b.closes_at) {
      return new Date(a.closes_at).getTime() - new Date(b.closes_at).getTime();
    }
    return b.probability - a.probability;
  });

  const isIndependent = event.event_type === 'independent' || event.event_type === 'sports_props';
  const maxProb = sorted.length > 0 ? sorted[0].probability : 1;
  const typeBadge = event.event_type === 'sports_props' ? 'GAME PROPS' : isIndependent ? 'INDEPENDENT' : 'PICK ONE';

  const shown = chartType === 'list' ? sorted.slice(0, LIST_TOP_N) : sorted.slice(0, visibleCount);
  const hiddenCount = chartType === 'list' ? Math.max(sorted.length - LIST_TOP_N, 0) : sorted.length - visibleCount;

  return (
    <div id={`event-${event.id}`} className="card overflow-hidden">
      <button
        className="w-full px-4 py-3 text-left transition-colors hover:bg-subtle/30"
        onClick={() => setOpen(!open)}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="rounded bg-accent/20 border border-accent/50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-accent flex-shrink-0">
              {event.outcomes.length} OUTCOMES
            </span>
            {badge === 'closing_soon' && (
              <span className="rounded bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-400 flex-shrink-0">
                &#9201; CLOSING SOON
              </span>
            )}
            {badge === 'hot' && (
              <span className="rounded bg-orange-500/15 border border-orange-500/40 px-1.5 py-0.5 font-mono text-[9px] font-bold text-orange-400 flex-shrink-0">
                &#128293; HOT
              </span>
            )}
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
            <CountdownTimer closesAt={event.closes_at} resolved={event.resolved} activeOutcomes={event.active_outcomes} className="hidden sm:block" />
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
              {event.event_type === 'sports_props'
                ? 'Individual props and markets for this game'
                : isIndependent
                ? 'Each outcome resolves independently — multiple can be true'
                : 'Only one outcome wins'}
            </span>
          </div>

          {/* Outcome display — bar, list, or line (chosen by decision engine) */}
          {chartType === 'bar' && (
            <div className="space-y-1.5 mb-4">
              {shown.map((outcome, i) => (
                <OutcomeBar key={outcome.market_id} outcome={outcome} index={i} isIndependent={isIndependent} maxProb={maxProb} />
              ))}
            </div>
          )}

          {chartType === 'list' && (
            <div className="space-y-1 mb-4">
              {shown.map((outcome) => (
                <div key={outcome.market_id} className="flex items-center gap-2">
                  <span className="font-mono text-xs text-white w-12 text-right font-semibold flex-shrink-0">
                    {(outcome.probability * 100).toFixed(1)}%
                  </span>
                  <span className="font-mono text-[10px] text-muted">{outcome.label}</span>
                  {outcome.passed && (
                    <span className="rounded bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-400 flex-shrink-0">
                      PASSED
                    </span>
                  )}
                </div>
              ))}
              {hiddenCount > 0 && (
                <button
                  onClick={() => setVisibleCount(sorted.length)}
                  className="w-full rounded border border-border py-1.5 font-mono text-[10px] text-muted hover:border-accent hover:text-accent transition-colors"
                >
                  +{hiddenCount} more outcomes
                </button>
              )}
            </div>
          )}

          {/* Show more / collapse for bar mode */}
          {chartType === 'bar' && hiddenCount > 0 && (
            <button
              onClick={() => setVisibleCount(v => Math.min(v + LOAD_MORE_STEP, sorted.length))}
              className="mb-4 w-full rounded border border-border py-1.5 font-mono text-[10px] text-muted hover:border-accent hover:text-accent transition-colors"
            >
              SHOW {Math.min(hiddenCount, LOAD_MORE_STEP)} MORE ({hiddenCount} remaining)
            </button>
          )}
          {chartType === 'bar' && visibleCount > INITIAL_VISIBLE && (
            <button
              onClick={() => setVisibleCount(INITIAL_VISIBLE)}
              className="mb-4 w-full rounded border border-border py-1.5 font-mono text-[10px] text-muted hover:border-accent hover:text-accent transition-colors"
            >
              COLLAPSE
            </button>
          )}

          {/* Live prices for CRYPTO/MACRO events */}
          {(event.category === 'CRYPTO' || event.category === 'MACRO') && (
            <EventPrices />
          )}

          {/* Agent bets on this event */}
          <EventBets eventId={event.id} />
        </div>
      )}
    </div>
  );
}

function OutcomeBar({ outcome, index, isIndependent, maxProb }: {
  outcome: EventOutcome; index: number; isIndependent: boolean; maxProb: number;
}) {
  const passed = outcome.passed;
  const rawWidth = isIndependent
    ? outcome.probability * 100
    : maxProb > 0 ? (outcome.probability / maxProb) * 100 : 0;
  const barWidth = rawWidth > 0 ? `max(4px, ${rawWidth}%)` : '0%';
  const barColor = passed
    ? '#444444'
    : isIndependent ? '#60a5fa' : index === 0 ? '#ff4400' : index === 1 ? '#cc3600' : '#555555';

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-xs text-white w-12 text-right font-semibold flex-shrink-0">
        {`${(outcome.probability * 100).toFixed(1)}%`}
      </span>
      <div className="flex-1 h-4 rounded bg-subtle overflow-hidden relative">
        <div
          className="h-full rounded transition-all duration-500"
          style={{ width: barWidth, background: barColor }}
        />
        <span className="absolute inset-0 flex items-center px-2 font-mono text-[10px] font-medium truncate text-white">
          {outcome.label}
        </span>
      </div>
      {passed && (
        <span className="rounded bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-400 flex-shrink-0">
          PASSED
        </span>
      )}
    </div>
  );
}
