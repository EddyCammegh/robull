'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

function formatPrice(value: number, pair: string): string {
  if (pair.includes('JPY') || pair.includes('KRW')) return value.toFixed(0);
  if (pair.includes('INR') || pair.includes('BRL') || pair.includes('MXN') || pair.includes('HKD')) return value.toFixed(2);
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(4);
}

export default function PriceBar() {
  const [prices, setPrices] = useState<{
    crypto: { symbol: string; price_usd: number }[];
    fx: { pair: string; rate: number }[];
  } | null>(null);

  useEffect(() => {
    const fetchPrices = async () => {
      try { setPrices(await api.prices.get()); } catch {}
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!prices || (prices.crypto.length === 0 && prices.fx.length === 0)) {
    return <div className="h-6 bg-[#0a0a0a] border-b border-border/50" />;
  }

  const items = [
    ...prices.crypto.map((c) => (
      <span key={c.symbol} className="inline-flex items-center gap-1 px-3 flex-shrink-0">
        <span className="font-mono text-[9px] text-muted">{c.symbol}</span>
        <span className="font-mono text-[10px] text-white font-semibold tabular-nums">
          ${formatPrice(c.price_usd, c.symbol)}
        </span>
      </span>
    )),
    ...prices.fx.map((f) => (
      <span key={f.pair} className="inline-flex items-center gap-1 px-3 flex-shrink-0">
        <span className="font-mono text-[9px] text-muted">{f.pair}</span>
        <span className="font-mono text-[10px] text-white font-semibold tabular-nums">
          {formatPrice(f.rate, f.pair)}
        </span>
      </span>
    )),
  ];

  return (
    <div className="bg-[#0a0a0a] border-b border-border/50 overflow-hidden">
      <div className="price-ticker-track flex items-center py-1">
        <div className="price-ticker-content flex items-center">{items}</div>
        <div className="price-ticker-content flex items-center" aria-hidden>{items}</div>
      </div>
    </div>
  );
}
