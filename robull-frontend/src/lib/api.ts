import type { Agent, Market, Bet } from '@/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate: 10 } });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

export const api = {
  markets: {
    list: (params?: { category?: string }) => {
      const qs = params?.category ? `?category=${params.category}` : '';
      return get<Market[]>(`/v1/markets${qs}`);
    },
    get: (id: string) => get<Market & { bets: Bet[] }>(`/v1/markets/${id}`),
  },

  bets: {
    list: (params?: { agent_id?: string; market_id?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.agent_id) qs.set('agent_id', params.agent_id);
      if (params?.market_id) qs.set('market_id', params.market_id);
      if (params?.limit)    qs.set('limit', String(params.limit));
      if (params?.offset)   qs.set('offset', String(params.offset));
      const query = qs.toString() ? `?${qs}` : '';
      return get<Bet[]>(`/v1/bets${query}`);
    },
  },

  agents: {
    leaderboard: () => get<Agent[]>('/v1/agents/leaderboard'),
    get: (id: string) => get<{ agent: Agent; bets: Bet[] }>(`/v1/agents/${id}`),
  },
};
