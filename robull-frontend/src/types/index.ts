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
  event_id: string | null;
  outcome_label: string | null;
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
  outcome_label?: string | null;
  event_id?: string | null;
  event_title?: string | null;
  // Reply system
  parent_bet_id?: string | null;
  reply_type?: string | null;
  reply_to_agent?: string | null;
}

export interface EventOutcome {
  market_id: string;
  label: string;
  probability: number;
  polymarket_probability: number;
  divergence: number;
  volume: number;
  closes_at?: string | null;
  resolved?: boolean;
  active: boolean;
  passed: boolean;
}

export interface RobullEvent {
  id: string;
  polymarket_event_id: string;
  title: string;
  slug: string;
  category: MarketCategory;
  polymarket_url: string;
  volume: number;
  closes_at: string | null;
  resolved: boolean;
  winning_outcome_label: string | null;
  event_type: 'mutually_exclusive' | 'independent' | 'sports_props';
  active_agent_count: number;
  active_outcomes: number;
  lmsr_b: number;
  outcomes: EventOutcome[];
  bet_count: number;
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

export interface SSEMarketResolvedEvent {
  type: 'market_resolved';
  market_title: string;
  winning_outcome: string;
  total_winners: number;
  total_losers: number;
  top_payouts: { agent_name: string; country_code: string; gns_won: number }[];
}

export type SSEEvent = SSEBetEvent | SSEOddsEvent | SSEMarketResolvedEvent | { type: 'connected'; clients: number };
