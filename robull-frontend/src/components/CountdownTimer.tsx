'use client';

import { useState, useEffect } from 'react';
import clsx from 'clsx';

type Urgency = 'closed' | 'closing' | 'under1h' | 'under24h' | 'open';

function formatCountdown(ms: number): { text: string; urgency: Urgency } {
  if (ms <= 0) return { text: 'CLOSED', urgency: 'closed' };

  const THIRTY_MIN = 30 * 60 * 1000;
  const ONE_HOUR   = 60 * 60 * 1000;
  const ONE_DAY    = 24 * 60 * 60 * 1000;

  if (ms <= THIRTY_MIN) return { text: 'CLOSING SOON', urgency: 'closing' };

  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (ms <= ONE_HOUR) return { text: `${m}m ${s}s`, urgency: 'under1h' };

  if (h > 0) {
    const d = Math.floor(h / 24);
    if (d > 0) return { text: `${d}d ${h % 24}h`, urgency: ms <= ONE_DAY ? 'under24h' : 'open' };
    return { text: `${h}h ${m}m`, urgency: 'under24h' };
  }
  return { text: `${m}m ${s}s`, urgency: 'under1h' };
}

interface CountdownTimerProps {
  closesAt: string | null | undefined;
  resolved?: boolean;
  activeOutcomes?: number;
  size?: 'sm' | 'md';
  className?: string;
}

export default function CountdownTimer({ closesAt, resolved, activeOutcomes, size = 'sm', className }: CountdownTimerProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const textSize = size === 'md' ? 'text-xs' : 'text-[10px]';

  if (resolved) {
    return (
      <span className={clsx('font-mono font-bold text-red-500', textSize, className)}>
        CLOSED
      </span>
    );
  }

  if (!closesAt) return null;

  const ms = new Date(closesAt).getTime() - now;

  // If not resolved but closes_at has passed, show contextual label
  if (ms <= 0 && !resolved) {
    // Event with active outcomes remaining
    if (activeOutcomes != null && activeOutcomes > 0) {
      return (
        <span className={clsx('font-mono font-bold text-gray-300', textSize, className)}>
          {activeOutcomes} OUTCOME{activeOutcomes !== 1 ? 'S' : ''} OPEN
        </span>
      );
    }
    // Standalone market awaiting Polymarket resolution
    return (
      <span className={clsx('font-mono font-bold text-amber-400', textSize, className)}>
        RESOLVING
      </span>
    );
  }

  const { text, urgency } = formatCountdown(ms);

  if (urgency === 'closing') {
    return (
      <span
        className={clsx(
          'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono font-bold animate-pulse',
          'bg-orange-500/20 border border-orange-500/40 text-orange-400',
          textSize,
          className,
        )}
      >
        <span>⏱</span> {text}
      </span>
    );
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 font-mono font-bold',
        urgency === 'closed' && 'text-red-500',
        urgency === 'under1h' && 'text-orange-400',
        urgency === 'under24h' && 'text-amber-400',
        urgency === 'open' && 'text-gray-300',
        textSize,
        className,
      )}
    >
      <span>⏱</span> {text}
    </span>
  );
}
