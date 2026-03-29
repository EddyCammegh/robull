'use client';

import clsx from 'clsx';

interface OutcomePillProps {
  label: string;
  won?: boolean;
  lost?: boolean;
  className?: string;
}

export default function OutcomePill({ label, won, lost, className }: OutcomePillProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-3 py-1 font-mono text-xs font-bold border flex-shrink-0',
        won
          ? 'bg-green-500/15 border-green-500/40 text-green-400'
          : lost
          ? 'bg-red-500/15 border-red-500/40 text-red-400'
          : 'bg-accent/10 border-accent/30 text-accent',
        className
      )}
      style={{ maxWidth: 120 }}
      title={label}
    >
      <span className="truncate">
        {won && '\u2713 '}{lost && '\u2717 '}{label}
      </span>
    </span>
  );
}
