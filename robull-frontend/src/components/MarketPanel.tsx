'use client';

import CountdownTimer from './CountdownTimer';
import SparklineChart from './SparklineChart';
import { useMarketClick } from './MarketClickProvider';
import type { Market, RobullEvent } from '@/types';

type SelectionBadge = 'closing_soon' | 'hot' | undefined;

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
      .slice(0, 3)
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

      {/* Sparklines per outcome */}
      <div className="mt-auto mb-1 space-y-0.5">
        {outcomes.map((o, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="font-mono text-[8px] text-muted truncate w-14 flex-shrink-0">
              {o.label.length > 8 ? o.label.slice(0, 8) + '..' : o.label}
            </span>
            <div className="flex-1 min-w-0">
              <SparklineChart
                currentValue={o.probability}
                height={16}
                color={o.isLeader ? '#FF4400' : '#666666'}
              />
            </div>
            <span className="font-mono text-[9px] text-white font-semibold w-7 text-right flex-shrink-0">
              {(o.probability * 100).toFixed(0)}%
            </span>
          </div>
        ))}
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
