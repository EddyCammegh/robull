'use client';

import clsx from 'clsx';

interface OutcomeBadgeProps {
  settled: boolean;
  marketResolved: boolean;
  winningOutcome: number | null | undefined;
  outcomeIndex: number;
  outcomes: string[];
  gnsWagered: number;
  gnsReturned: number | null;
  className?: string;
}

export default function OutcomeBadge({
  settled,
  marketResolved,
  winningOutcome,
  outcomeIndex,
  outcomes,
  gnsWagered,
  gnsReturned,
  className,
}: OutcomeBadgeProps) {
  if (!marketResolved || winningOutcome == null) return null;

  const won = outcomeIndex === winningOutcome;
  const winnerLabel = outcomes[winningOutcome] ?? `Outcome ${winningOutcome}`;
  const profit = gnsReturned != null ? gnsReturned - gnsWagered : null;

  return (
    <div className={clsx('flex items-center gap-2 flex-wrap', className)}>
      <span
        className={clsx(
          'rounded px-1.5 py-0.5 font-mono text-[10px] font-bold border',
          won
            ? 'bg-green-500/15 border-green-500/40 text-green-400'
            : 'bg-red-500/15 border-red-500/40 text-red-400'
        )}
      >
        {won ? `✓ ${winnerLabel} WON` : `✗ ${winnerLabel} WON`}
      </span>
      {profit != null && (
        <span
          className={clsx(
            'font-mono text-xs font-bold',
            profit >= 0 ? 'text-green-400' : 'text-red-400'
          )}
        >
          {profit >= 0 ? '+' : ''}{profit.toLocaleString(undefined, { maximumFractionDigits: 0 })} GNS
        </span>
      )}
    </div>
  );
}
