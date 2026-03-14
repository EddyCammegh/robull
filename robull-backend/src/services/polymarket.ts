import { MarketCategory, PolymarketMarket } from '../types/index.js';
import { computeB, bootstrapQuantities } from './lmsr.js';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const MIN_VOLUME = Number(process.env.MARKET_MIN_VOLUME ?? 5000);

interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  outcomePrices: string; // JSON array of price strings e.g. '["0.65","0.35"]'
  outcomes: string;      // JSON array e.g. '["Yes","No"]'
  volume: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  new: boolean;
  tags?: { label: string }[];
  conditionId?: string;
}

export interface NormalisedMarket {
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
}

function classifyCategory(question: string, tags?: { label: string }[]): MarketCategory {
  const tagLabels = (tags ?? []).map((t) => t.label.toLowerCase());
  const q = question.toLowerCase();

  if (tagLabels.some((l) => l.includes('crypto') || l.includes('bitcoin') || l.includes('ethereum')) ||
      q.match(/bitcoin|btc|ethereum|eth|crypto|defi|nft|solana/)) return 'CRYPTO';
  if (tagLabels.some((l) => l.includes('politics') || l.includes('election') || l.includes('president')) ||
      q.match(/election|president|senate|congress|prime minister|vote|ballot|democrat|republican/)) return 'POLITICS';
  if (tagLabels.some((l) => l.includes('macro') || l.includes('economics') || l.includes('fed')) ||
      q.match(/fed|interest rate|inflation|gdp|recession|unemployment|powell|fomc/)) return 'MACRO';
  if (tagLabels.some((l) => l.includes('sports') || l.includes('nba') || l.includes('nfl')) ||
      q.match(/nba|nfl|nhl|mlb|fifa|world cup|champion|super bowl|playoff|tournament/)) return 'SPORTS';
  if (tagLabels.some((l) => l.includes('ai') || l.includes('tech') || l.includes('technology')) ||
      q.match(/ai|openai|gpt|anthropic|claude|gemini|llm|model|tech|apple|google|meta|microsoft/)) return 'AI/TECH';

  return 'OTHER';
}

export async function fetchPolymarkets(): Promise<NormalisedMarket[]> {
  const url = `${GAMMA_API}/markets?active=true&closed=false&limit=100&order=volume&ascending=false`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gamma API error: ${res.status}`);

  const markets = await res.json() as GammaMarket[];
  const results: NormalisedMarket[] = [];

  for (const m of markets) {
    const volume = parseFloat(m.volume ?? '0');
    if (volume < MIN_VOLUME) continue;
    if (!m.active || m.closed) continue;

    let outcomes: string[];
    let initialProbs: number[];

    try {
      outcomes = JSON.parse(m.outcomes);
      const prices = JSON.parse(m.outcomePrices).map(Number);
      // Normalise prices to sum to 1
      const total = prices.reduce((a: number, v: number) => a + v, 0);
      initialProbs = prices.map((p: number) => p / total);
    } catch {
      continue; // skip malformed markets
    }

    if (outcomes.length < 2) continue;

    const b = computeB(volume);
    const quantities = bootstrapQuantities(initialProbs, b);

    results.push({
      polymarket_id: m.id,
      question: m.question,
      category: classifyCategory(m.question, m.tags),
      polymarket_url: `https://polymarket.com/event/${m.slug}`,
      volume,
      b_parameter: b,
      outcomes,
      quantities,
      initial_probs: initialProbs,
      closes_at: m.endDate ?? null,
    });
  }

  return results;
}
