'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export default function EventPrices() {
  const [prices, setPrices] = useState<{
    crypto: { symbol: string; price_usd: number }[];
    fx: { pair: string; rate: number }[];
  } | null>(null);

  useEffect(() => {
    api.prices.get().then(setPrices).catch(() => {});
    const interval = setInterval(() => {
      api.prices.get().then(setPrices).catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!prices) return null;

  return (
    <div className="mb-4 rounded border border-border bg-[#161616] px-3 py-2">
      <div className="flex items-center gap-1 mb-1.5">
        <span className="font-mono text-[9px] text-muted uppercase tracking-widest">Live Prices</span>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px]">
        {prices.crypto.map((c) => (
          <span key={c.symbol} className="text-gray-300">
            <span className="text-muted">{c.symbol}</span>{' '}
            <span className="text-white font-semibold">
              ${c.price_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </span>
        ))}
        {prices.fx.map((f) => (
          <span key={f.pair} className="text-gray-300">
            <span className="text-muted">{f.pair}</span>{' '}
            <span className="text-white font-semibold">
              {f.rate.toFixed(f.pair.includes('JPY') || f.pair.includes('CNY') ? 2 : 4)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
