import type { Agent, Market, Bet, RobullEvent } from '@/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://robull-production.up.railway.app';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate: 10 } });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

// PostgreSQL NUMERIC columns arrive as strings. Coerce them to numbers.
function fixBetNumerics(b: any): Bet {
  return {
    ...b,
    gns_wagered: Number(b.gns_wagered) || 0,
    shares_received: Number(b.shares_received) || 0,
    price_per_share: Number(b.price_per_share) || 0,
    gns_returned: b.gns_returned != null ? Number(b.gns_returned) : null,
    confidence: Number(b.confidence) || 0,
  };
}

function fixMarketNumerics(m: any): Market {
  return {
    ...m,
    volume: Number(m.volume) || 0,
    b_parameter: Number(m.b_parameter) || 0,
    gns_balance: m.gns_balance != null ? Number(m.gns_balance) : undefined,
    bet_count: Number(m.bet_count) || 0,
    quantities: Array.isArray(m.quantities) ? m.quantities.map(Number) : [],
    initial_probs: Array.isArray(m.initial_probs) ? m.initial_probs.map(Number) : [],
    current_probs: Array.isArray(m.current_probs) ? m.current_probs.map(Number) : [],
  };
}

function fixAgentNumerics(a: any): Agent {
  return {
    ...a,
    gns_balance: Number(a.gns_balance) || 0,
    roi: Number(a.roi) || 0,
    win_rate: Number(a.win_rate) || 0,
    total_bets: Number(a.total_bets) || 0,
    wins: Number(a.wins) || 0,
    losses: Number(a.losses) || 0,
  };
}

export { fixBetNumerics, fixMarketNumerics, fixAgentNumerics };

export const api = {
  markets: {
    list: async (params?: { category?: string }) => {
      const qs = new URLSearchParams({ include_recent: '12h' });
      if (params?.category) qs.set('category', params.category);
      const raw = await get<any[]>(`/v1/markets?${qs}`);
      return raw.map(fixMarketNumerics);
    },
    get: async (id: string) => {
      const raw = await get<any>(`/v1/markets/${id}`);
      return {
        ...fixMarketNumerics(raw),
        bets: Array.isArray(raw.bets) ? raw.bets.map(fixBetNumerics) : [],
      } as Market & { bets: Bet[] };
    },
  },

  bets: {
    list: async (params?: { agent_id?: string; market_id?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.agent_id) qs.set('agent_id', params.agent_id);
      if (params?.market_id) qs.set('market_id', params.market_id);
      if (params?.limit)    qs.set('limit', String(params.limit));
      if (params?.offset)   qs.set('offset', String(params.offset));
      const query = qs.toString() ? `?${qs}` : '';
      const raw = await get<any[]>(`/v1/bets${query}`);
      return raw.map(fixBetNumerics);
    },
  },

  events: {
    list: async () => {
      const raw = await get<any[]>('/v1/events');
      return raw.map((e) => ({
        ...e,
        volume: Number(e.volume) || 0,
        bet_count: Number(e.bet_count) || 0,
        active_agent_count: Number(e.active_agent_count) || 0,
        active_outcomes: Number(e.active_outcomes) || 0,
        lmsr_b: Number(e.lmsr_b) || 200,
        event_type: e.event_type ?? 'mutually_exclusive',
        outcomes: Array.isArray(e.outcomes) ? e.outcomes.map((o: any) => ({
          ...o,
          probability: Number(o.probability) || 0,
          polymarket_probability: Number(o.polymarket_probability) || 0,
          divergence: Number(o.divergence) || 0,
          volume: Number(o.volume) || 0,
          active: o.active ?? true,
          passed: o.passed ?? false,
        })) : [],
      })) as RobullEvent[];
    },
  },

  agents: {
    leaderboard: async () => {
      const raw = await get<any[]>('/v1/agents/leaderboard');
      return raw.map(fixAgentNumerics);
    },
    get: async (id: string) => {
      const raw = await get<any>(`/v1/agents/${id}`);
      return {
        agent: fixAgentNumerics(raw.agent),
        bets: Array.isArray(raw.bets) ? raw.bets.map(fixBetNumerics) : [],
      } as { agent: Agent; bets: Bet[] };
    },
  },

  prices: {
    get: () => get<{
      crypto: { id: string; symbol: string; price_usd: number }[];
      fx: { pair: string; rate: number }[];
      updated_at: string;
    }>('/v1/prices'),
  },

  news: {
    forEvent: (eventId: string) => get<{
      articles: { title: string; url: string; source: string; published_at: string; summary: string }[];
      prices: { crypto: { symbol: string; price_usd: number }[]; fx: { pair: string; rate: number }[] } | null;
    }>(`/v1/events/${eventId}/news`),
  },

  priceHistory: {
    get: (params: { market_id?: string; event_id?: string; hours?: number }) => {
      const qs = new URLSearchParams();
      if (params.market_id) qs.set('market_id', params.market_id);
      if (params.event_id) qs.set('event_id', params.event_id);
      if (params.hours) qs.set('hours', String(params.hours));
      return get<Record<string, { probability: number; recorded_at: string }[]>>(`/v1/price-history?${qs}`);
    },
  },
};
