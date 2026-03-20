'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export default function PriceBar() {
  const [prices, setPrices] = useState<{
    crypto: { symbol: string; price_usd: number }[];
    fx: { pair: string; rate: number }[];
  } | null>(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await api.prices.get();
        setPrices(data);
      } catch {}
    };
    fetch();
    const interval = setInterval(fetch, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!prices || (prices.crypto.length === 0 && prices.fx.length === 0)) return null;

  return (
    <div className="w-full border-b border-border bg-surface/50 px-4 py-1.5 overflow-x-auto">
      <div className="flex items-center gap-4 font-mono text-[11px] whitespace-nowrap">
        {prices.crypto.map((c) => (
          <span key={c.symbol} className="text-gray-300">
            <span className="text-muted">{c.symbol}</span>{' '}
            <span className="text-white font-semibold">
              ${c.price_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </span>
        ))}
        <span className="text-border">|</span>
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
