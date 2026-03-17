'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import { useMarketClick } from './MarketClickProvider';
import PolymarketButton from './PolymarketButton';
import CountdownTimer from './CountdownTimer';
import OutcomeBadge from './OutcomeBadge';
import type { Bet, MarketCategory } from '@/types';

const CATEGORY_CLASS: Record<MarketCategory, string> = {
  MACRO:         'cat-MACRO',
  POLITICS:      'cat-POLITICS',
  CRYPTO:        'cat-CRYPTO',
  SPORTS:        'cat-SPORTS',
  'AI/TECH':     'cat-AITECH',
  ENTERTAINMENT: 'cat-ENTERTAINMENT',
  OTHER:         'cat-OTHER',
};

function countryFlag(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

function formatGNS(amount: number): string {
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

interface BetCardProps {
  bet: Bet;
  isNew?: boolean;
  isPinned?: boolean;
  onPin?: (id: string | null) => void;
}

export default function BetCard({ bet, isNew = false, isPinned = false, onPin }: BetCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { openMarket } = useMarketClick();

  const agentName   = bet.agent_name ?? (bet as any).agent?.name ?? 'Unknown';
  const countryCode = bet.country_code ?? (bet as any).agent?.country_code ?? 'XX';
  const org         = bet.org ?? (bet as any).agent?.org ?? '';
  const model       = bet.model ?? (bet as any).agent?.model ?? '';
  const question    = bet.question ?? (bet as any).market?.question ?? '';
  const polyUrl     = bet.polymarket_url ?? (bet as any).market?.polymarket_url ?? '#';
  const category    = (bet.category ?? (bet as any).market?.category ?? 'OTHER') as MarketCategory;
  const outcomes    = bet.outcomes ?? (bet as any).market?.outcomes ?? [];
  const outcomeName = bet.outcome_name ?? outcomes[bet.outcome_index] ?? `Outcome ${bet.outcome_index}`;

  const reasoning       = bet.reasoning ?? '';
  const REASONING_LIMIT = 280;
  const isLong          = reasoning.length > REASONING_LIMIT;

  const tweetText = encodeURIComponent(
    `${agentName} (${org}) bets ${formatGNS(bet.gns_wagered)} GNS on "${outcomeName}" — ${bet.confidence}% confidence\n\n"${reasoning.slice(0, 200)}${reasoning.length > 200 ? '…' : ''}"\n\nSee the bet on Robull: https://robull.ai`
  );

  function handleCardClick(e: React.MouseEvent) {
    // Don't pin when clicking interactive child elements (buttons, links)
    if ((e.target as HTMLElement).closest('button, a')) return;
    onPin?.(isPinned ? null : bet.id);
  }

  return (
    <article
      className={clsx(
        'card p-4 transition-all duration-200',
        isPinned
          ? 'border-accent shadow-[0_0_12px_rgba(255,68,0,0.25)]'
          : isNew
          ? 'bet-new border-accent/40 hover:border-subtle'
          : 'hover:border-subtle',
        onPin && 'cursor-pointer'
      )}
      onClick={handleCardClick}
      title={onPin ? (isPinned ? 'Click to unpin' : 'Click to pin to top') : undefined}
    >
      {/* Pinned banner */}
      {isPinned && (
        <div className="mb-3 flex items-center justify-between rounded bg-accent/10 border border-accent/30 px-2 py-1">
          <span className="font-mono text-[10px] font-bold text-accent tracking-widest">
            📌 PINNED
          </span>
          <button
            onClick={() => onPin?.(null)}
            className="font-mono text-[10px] text-muted hover:text-white transition-colors"
          >
            UNPIN ✕
          </button>
        </div>
      )}

      {/* Header row */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl leading-none" title={countryCode}>
            {countryFlag(countryCode)}
          </span>
          <div className="min-w-0">
            <span className="font-mono text-sm font-semibold text-white truncate block">
              {agentName}
            </span>
            <span className="font-mono text-xs text-muted">
              {org}{org && model ? ' · ' : ''}{model}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className={clsx(
              'rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase',
              CATEGORY_CLASS[category]
            )}
          >
            {category}
          </span>
          <span className="font-mono text-xs text-muted">
            {formatDistanceToNow(new Date(bet.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>

      {/* Market question — clickable pill to open detail + countdown */}
      <button
        onClick={(e) => { e.stopPropagation(); openMarket(bet.market_id); }}
        className="mb-3 w-full rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-left cursor-pointer transition-all hover:border-accent/60 hover:bg-accent/10"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="font-mono text-xs text-gray-200 leading-relaxed line-clamp-2 flex-1">
            {question}
          </p>
          <CountdownTimer closesAt={bet.closes_at} size="md" className="flex-shrink-0 mt-0.5" />
        </div>
      </button>

      {/* Bet summary */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="rounded bg-accent/10 border border-accent/30 px-2 py-1 font-mono text-sm font-bold text-accent">
          {outcomeName}
        </span>
        <span className="font-mono text-xs text-white">
          <span className="text-muted">WAGERED</span>{' '}
          <span className="font-semibold">{formatGNS(bet.gns_wagered)} GNS</span>
        </span>
        <span className="font-mono text-xs text-white">
          <span className="text-muted">CONFIDENCE</span>{' '}
          <span className="font-semibold">{bet.confidence}%</span>
        </span>
      </div>

      {/* Outcome result (resolved markets only) */}
      <OutcomeBadge
        settled={bet.settled}
        marketResolved={bet.market_resolved ?? false}
        winningOutcome={bet.winning_outcome}
        outcomeIndex={bet.outcome_index}
        outcomes={outcomes}
        gnsWagered={bet.gns_wagered}
        gnsReturned={bet.gns_returned}
        className="mb-3"
      />

      {/* Confidence bar */}
      <div className="mb-3 h-1 w-full rounded-full bg-subtle">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${bet.confidence}%` }}
        />
      </div>

      {/* Reasoning */}
      <div className="mb-3 rounded bg-surface border border-border p-3">
        <p className="font-body text-sm leading-relaxed text-gray-300">
          {isLong && !expanded
            ? `${reasoning.slice(0, REASONING_LIMIT)}…`
            : reasoning}
        </p>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 font-mono text-xs text-accent hover:text-accent-dim"
          >
            {expanded ? 'COLLAPSE' : 'READ MORE'}
          </button>
        )}
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2">
        <PolymarketButton url={polyUrl} question={question} />
        <a
          href={`https://twitter.com/intent/tweet?text=${tweetText}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-border px-3 py-2 font-mono text-xs text-muted transition-colors hover:border-white hover:text-white"
          title="Share on X"
        >
          𝕏
        </a>
      </div>
    </article>
  );
}
