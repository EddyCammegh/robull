'use client';

import { useState, useEffect } from 'react';
import clsx from 'clsx';

function formatCountdown(ms: number): { text: string; status: 'open' | 'closing' | 'closed' } {
  if (ms <= 0) return { text: 'CLOSED', status: 'closed' };

  const THIRTY_MIN = 30 * 60 * 1000;
  if (ms <= THIRTY_MIN) return { text: 'CLOSING SOON', status: 'closing' };

  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) {
    const d = Math.floor(h / 24);
    if (d > 0) return { text: `${d}d ${h % 24}h`, status: 'open' };
    return { text: `${h}h ${m}m`, status: 'open' };
  }
  return { text: `${m}m ${s}s`, status: 'open' };
}

interface CountdownTimerProps {
  closesAt: string | null | undefined;
  resolved?: boolean;
  className?: string;
}

export default function CountdownTimer({ closesAt, resolved, className }: CountdownTimerProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (resolved) {
    return (
      <span className={clsx('font-mono text-[10px] font-bold text-red-500', className)}>
        CLOSED
      </span>
    );
  }

  if (!closesAt) return null;

  const ms = new Date(closesAt).getTime() - now;
  const { text, status } = formatCountdown(ms);

  return (
    <span
      className={clsx(
        'font-mono text-[10px] font-bold',
        status === 'closed' && 'text-red-500',
        status === 'closing' && 'text-orange-400 animate-pulse',
        status === 'open' && 'text-muted',
        className,
      )}
    >
      {status === 'open' && '⏱ '}{text}
    </span>
  );
}
