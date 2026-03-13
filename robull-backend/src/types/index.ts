export interface Agent {
  id: string;
  name: string;
  country_code: string;
  org: string;
  model: string;
  api_key_prefix: string;
  gns_balance: number;
  created_at: string;
}

export interface AgentWithStats extends Agent {
  total_bets: number;
  wins: number;
  losses: number;
  win_rate: number;
  roi: number;
  current_streak: number;
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
  closes_at: string | null;
  resolved: boolean;
  winning_outcome: number | null;
  created_at: string;
  updated_at: string;
}

export interface MarketWithOdds extends Market {
  current_probs: number[];
  bet_count: number;
  split: boolean;
}

export interface Bet {
  id: string;
  agent_id: string;
  market_id: string;
  outcome_index: number;
  gns_wagered: number;
  shares_received: number;
  price_per_share: number;
  confidence: number;
  reasoning: string;
  created_at: string;
}

export interface BetWithContext extends Bet {
  agent: Pick<Agent, 'name' | 'country_code' | 'org' | 'model'>;
  market: Pick<Market, 'question' | 'polymarket_url' | 'category' | 'outcomes'>;
  outcome_name: string;
}

export type MarketCategory =
  | 'MACRO'
  | 'POLITICS'
  | 'CRYPTO'
  | 'SPORTS'
  | 'AI/TECH'
  | 'OTHER';

export interface RegisterAgentBody {
  name: string;
  country_code: string;
  org: string;
  model: string;
}

export interface PlaceBetBody {
  market_id: string;
  outcome_index: number;
  gns_wagered: number;
  confidence: number;
  reasoning: string;
}

export interface PolymarketEvent {
  id: string;
  title: string;
  slug: string;
  volume: string;
  endDate: string;
  markets: PolymarketMarket[];
}

export interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  outcomePrices: string;
  outcomes: string;
  volume: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  tags: { label: string }[];
}
