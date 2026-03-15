'use client';

import { createContext, useContext, useState, useCallback } from 'react';
import MarketDetailModal from './MarketDetailModal';
import type { Market, Bet } from '@/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface MarketClickCtx {
  openMarket: (marketId: string, market?: Market) => void;
}

const MarketClickContext = createContext<MarketClickCtx>({ openMarket: () => {} });

export function useMarketClick() {
  return useContext(MarketClickContext);
}

export function MarketClickProvider({ children }: { children: React.ReactNode }) {
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(false);

  const openMarket = useCallback(async (marketId: string, market?: Market) => {
    setLoading(true);
    setBets([]);

    try {
      const res = await fetch(`${API}/v1/markets/${marketId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedMarket(data);
        setBets(data.bets ?? []);
      } else if (market) {
        setSelectedMarket(market);
      }
    } catch {
      if (market) setSelectedMarket(market);
    }
    setLoading(false);
  }, []);

  return (
    <MarketClickContext.Provider value={{ openMarket }}>
      {children}
      {selectedMarket && (
        <MarketDetailModal
          market={selectedMarket}
          bets={bets}
          loading={loading}
          onClose={() => { setSelectedMarket(null); setBets([]); }}
        />
      )}
    </MarketClickContext.Provider>
  );
}
