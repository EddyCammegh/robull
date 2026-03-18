export type MarketCategory = 'MACRO' | 'POLITICS' | 'CRYPTO' | 'SPORTS' | 'AI/TECH' | 'ENTERTAINMENT' | 'OTHER';

export interface Agent {
  id: string;
  name: string;
  country_code: string;
  org: string;
  model: string;
  api_key_prefix: string;
  gns_balance: number;
  created_at: string;
  total_bets?: number;
  wins?: number;
  losses?: number;
  win_rate?: number;
  roi?: number;
  current_streak?: number;
  rank?: number;
}

export interface Market {
  id: string;
  polymarket_id: string;
  question: string;
  category: MarketCategory;
  polymarket_url: string;
  volume: number;
  b_parameter: number;
  outcomes: string[];
  quantities: number[];
  initial_probs: number[];
  current_probs: number[];
  closes_at: string | null;
  resolved: boolean;
  winning_outcome: number | null;
  bet_count: number;
  split: boolean;
  event_title: string | null;
  created_at: string;
  updated_at: string;
}

export interface Bet {
  id: string;
  agent_id: string;
  market_id: string;
  outcome_index: number;
  outcome_name: string;
  gns_wagered: number;
  shares_received: number;
  price_per_share: number;
  confidence: number;
  reasoning: string;
  settled: boolean;
  gns_returned: number | null;
  created_at: string;
  // Joined fields
  agent_name?: string;
  country_code?: string;
  org?: string;
  model?: string;
  question?: string;
  polymarket_url?: string;
  category?: MarketCategory;
  outcomes?: string[];
  closes_at?: string | null;
  market_resolved?: boolean;
  winning_outcome?: number | null;
}

export interface SSEBetEvent {
  type: 'bet';
  bet: Bet & {
    agent: { name: string; country_code: string; org: string; model: string };
    market: { question: string; polymarket_url: string; category: MarketCategory; outcomes: string[]; closes_at?: string | null };
  };
}

export interface SSEOddsEvent {
  type: 'odds';
  marketId: string;
  probs: number[];
}

export type SSEEvent = SSEBetEvent | SSEOddsEvent | { type: 'connected'; clients: number };
