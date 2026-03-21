'use client';

import CountdownTimer from './CountdownTimer';
import { useMarketClick } from './MarketClickProvider';
import { getChartType } from '@/lib/chartDecision';
import type { Market, RobullEvent } from '@/types';

type SelectionBadge = 'closing_soon' | 'hot' | undefined;

const OUTCOME_COLOURS = ['#FF4400', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#6B7280'];

interface OutcomeInfo {
  label: string;
  probability: number; // 0-1
  isLeader: boolean;
}

function getOutcomes(kind: 'market' | 'event', market?: Market, event?: RobullEvent, liveProbs?: number[]): OutcomeInfo[] {
  if (kind === 'market' && market) {
    const probs = liveProbs ?? market.current_probs ?? market.initial_probs ?? [];
    return market.outcomes.slice(0, 2).map((label, i) => ({
      label,
      probability: probs[i] ?? 0,
      isLeader: i === 0,
    }));
  }
  if (kind === 'event' && event) {
    return [...event.outcomes]
      .filter(o => !o.passed)
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 5)
      .map((o, i) => ({
        label: o.label,
        probability: o.probability,
        isLeader: i === 0,
      }));
  }
  return [];
}

interface MarketPanelProps {
  kind: 'market' | 'event';
  market?: Market;
  event?: RobullEvent;
  badge?: SelectionBadge;
  liveProbs?: number[];
}

export default function MarketPanel({ kind, market, event, badge, liveProbs }: MarketPanelProps) {
  const { openMarket, openEvent } = useMarketClick();

  const title = kind === 'market' ? market!.question : event!.title;
  const closesAt = kind === 'market' ? market!.closes_at : event!.closes_at;
  const resolved = kind === 'market' ? market!.resolved : event!.resolved;
  const betCount = kind === 'market' ? (market!.bet_count ?? 0) : (event!.bet_count ?? 0);
  const id = kind === 'market' ? market!.id : event!.id;

  const outcomes = getOutcomes(kind, market, event, liveProbs);
  const isBinary = outcomes.length <= 2;
  const isIndependent = kind === 'event' && event && (event.event_type === 'independent' || event.event_type === 'sports_props');
  const maxProb = outcomes.length > 0 ? outcomes[0].probability : 1;

  // Chart decision (no history available in mini cards → bar or list)
  const chartDecision = kind === 'event' && event
    ? getChartType(event, null)
    : { type: 'bar' as const };
  const showList = chartDecision.type === 'list';

  const handleClick = () => {
    if (kind === 'market') openMarket(id, market);
    else openEvent(id);
  };

  return (
    <button
      onClick={handleClick}
      title={title}
      className="group relative flex flex-col justify-between rounded-lg bg-surface border border-border p-3 text-left transition-all duration-150 hover:border-accent/60 hover:shadow-[0_0_12px_rgba(255,68,0,0.15)] hover:scale-[1.02] aspect-square cursor-pointer"
    >
      {/* Badge — top-right */}
      {badge === 'closing_soon' && (
        <span className="absolute top-2 right-2 rounded-full bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 font-mono text-[8px] font-bold text-amber-400 leading-none z-10">
          &#9201; CLOSING SOON
        </span>
      )}
      {badge === 'hot' && (
        <span className="absolute top-2 right-2 rounded-full bg-orange-500/15 border border-orange-500/40 px-1.5 py-0.5 font-mono text-[8px] font-bold text-orange-400 leading-none z-10">
          &#128293; HOT
        </span>
      )}

      {/* Title — max 2 lines */}
      <p className="font-body text-xs leading-tight text-white line-clamp-2 pr-16">
        {title}
      </p>

      {/* Probability display — bars or list */}
      <div className="mt-auto mb-1 space-y-1">
        {showList ? (
          <>
            {outcomes.slice(0, 4).map((o, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="font-mono text-[9px] text-white font-semibold w-7 flex-shrink-0">
                  {(o.probability * 100).toFixed(0)}%
                </span>
                <span className="font-mono text-[8px] text-muted truncate">
                  {o.label.length > 16 ? o.label.slice(0, 16) + '..' : o.label}
                </span>
              </div>
            ))}
            {outcomes.length > 4 && (
              <span className="font-mono text-[8px] text-muted">+{outcomes.length - 4} more</span>
            )}
          </>
        ) : (
          <>
            {outcomes.slice(0, isBinary ? 2 : 4).map((o, i) => {
              const colour = isBinary
                ? (o.isLeader ? '#FF4400' : '#666666')
                : (OUTCOME_COLOURS[i] ?? OUTCOME_COLOURS[OUTCOME_COLOURS.length - 1]);
              const barPct = (isBinary || isIndependent)
                ? o.probability * 100
                : (maxProb > 0 ? (o.probability / maxProb) * 100 : 0);

              return (
                <div key={i} className="flex items-center gap-1.5">
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#0d0d0d' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(barPct, 3)}%`,
                        background: colour,
                      }}
                    />
                  </div>
                  <span className="font-mono text-[9px] text-white font-semibold w-7 text-right flex-shrink-0">
                    {(o.probability * 100).toFixed(0)}%
                  </span>
                  <span className="font-mono text-[8px] text-muted truncate w-14 flex-shrink-0">
                    {o.label.length > 8 ? o.label.slice(0, 8) + '..' : o.label}
                  </span>
                </div>
              );
            })}
            {!isBinary && outcomes.length > 4 && (
              <span className="font-mono text-[8px] text-muted">+{outcomes.length - 4} more</span>
            )}
          </>
        )}
      </div>

      {/* Bottom row: countdown + bet count */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50">
        <CountdownTimer closesAt={closesAt} resolved={resolved} size="sm" />
        {betCount > 0 && (
          <span className="flex items-center gap-1 font-mono text-[9px] text-muted">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/60" />
            {betCount}
          </span>
        )}
      </div>
    </button>
  );
}
