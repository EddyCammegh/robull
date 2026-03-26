'use client';

import { createContext, useContext, useState, useCallback } from 'react';
import MarketDetailModal from './MarketDetailModal';
import EventDetailModal from './EventDetailModal';
import { fixMarketNumerics, fixBetNumerics } from '@/lib/api';
import type { Market, Bet } from '@/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://robull-production.up.railway.app';

interface MarketClickCtx {
  openMarket: (marketId: string, market?: Market) => void;
  openEvent: (eventId: string) => void;
}

const MarketClickContext = createContext<MarketClickCtx>({ openMarket: () => {}, openEvent: () => {} });

export function useMarketClick() {
  return useContext(MarketClickContext);
}

export function MarketClickProvider({ children }: { children: React.ReactNode }) {
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(false);

  const openMarket = useCallback(async (marketId: string, market?: Market) => {
    setLoading(true);
    setBets([]);
    setSelectedEvent(null);

    try {
      const res = await fetch(`${API}/v1/markets/${marketId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedMarket(fixMarketNumerics(data));
        setBets(Array.isArray(data.bets) ? data.bets.map(fixBetNumerics) : []);
      } else if (market) {
        setSelectedMarket(market);
      }
    } catch {
      if (market) setSelectedMarket(market);
    }
    setLoading(false);
  }, []);

  const openEvent = useCallback(async (eventId: string) => {
    setLoading(true);
    setSelectedMarket(null);
    setBets([]);

    try {
      const res = await fetch(`${API}/v1/events/${eventId}`);
      if (res.ok) {
        const data = await res.json();
        // Parse numeric fields
        data.volume = Number(data.volume) || 0;
        data.active_agent_count = Number(data.active_agent_count) || 0;
        data.active_outcomes = Number(data.active_outcomes) || 0;
        data.lmsr_b = Number(data.lmsr_b) || 200;
        if (Array.isArray(data.outcomes)) {
          data.outcomes = data.outcomes.map((o: any) => ({
            ...o,
            probability: Number(o.probability) || 0,
            polymarket_probability: Number(o.polymarket_probability) || 0,
            divergence: Number(o.divergence) || 0,
            volume: Number(o.volume) || 0,
            active: o.active ?? true,
            passed: o.passed ?? false,
          }));
        }
        if (Array.isArray(data.bets)) {
          data.bets = data.bets.map(fixBetNumerics);
        }
        setSelectedEvent(data);
      }
    } catch {
      // silently fail
    }
    setLoading(false);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedMarket(null);
    setSelectedEvent(null);
    setBets([]);
  }, []);

  return (
    <MarketClickContext.Provider value={{ openMarket, openEvent }}>
      {children}
      {loading && !selectedMarket && !selectedEvent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="font-mono text-xs text-muted animate-pulse">Loading...</div>
        </div>
      )}
      {selectedMarket && (
        <MarketDetailModal
          market={selectedMarket}
          bets={bets}
          loading={loading}
          onClose={handleClose}
        />
      )}
      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          loading={loading}
          onClose={handleClose}
        />
      )}
    </MarketClickContext.Provider>
  );
}
