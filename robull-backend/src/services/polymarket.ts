import { MarketCategory, PolymarketMarket } from '../types/index.js';
import { computeB, bootstrapQuantities } from './lmsr.js';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const MIN_VOLUME = Number(process.env.MARKET_MIN_VOLUME ?? 1000);

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

  if (tagLabels.some((l) => l.includes('crypto') || l.includes('bitcoin') || l.includes('ethereum') || l.includes('solana') || l.includes('blockchain') || l.includes('token') || l.includes('defi')) ||
      q.match(/bitcoin|btc|ethereum|eth\b|crypto|defi|nft|solana|sol\b|blockchain|token|altcoin|stablecoin|usdc|usdt|tether|binance|bnb|xrp|ripple|cardano|ada\b|avalanche|avax|polygon|matic|chainlink|link\b|uniswap|aave|doge|dogecoin|shiba|pepe\b|memecoin|coinbase|kraken|bybit/)) return 'CRYPTO';
  if (tagLabels.some((l) => l.includes('politics') || l.includes('election') || l.includes('president') || l.includes('parliament') || l.includes('government')) ||
      q.match(/election|president|senate|congress|prime minister|prime-minister|vote|ballot|democrat|republican|parliament|minister|chancellor|mayor|governor|political party|white house|cabinet|legislation|impeach|veto|tariff policy|nato|geopolit|war\b|ukraine|russia|china|taiwan|iran|israel|hamas|sanctions/)) return 'POLITICS';
  if (tagLabels.some((l) => l.includes('macro') || l.includes('economics') || l.includes('economy') || l.includes('fed') || l.includes('finance')) ||
      q.match(/\bfed\b|federal reserve|interest rate|inflation|gdp|recession|unemployment|powell|fomc|cpi|pce|treasury|bond yield|s&p|nasdaq|dow jones|stock market|ipo|earnings|tariff|trade war|deficit|debt ceiling|imf|world bank|monetary policy|fiscal/)) return 'MACRO';
  if (tagLabels.some((l) => l.includes('sports') || l.includes('nba') || l.includes('nfl') || l.includes('soccer') || l.includes('football') || l.includes('baseball') || l.includes('hockey') || l.includes('tennis') || l.includes('golf')) ||
      q.match(/\bnba\b|\bnfl\b|\bnhl\b|\bmlb\b|\bfifa\b|world cup|champions league|premier league|la liga|bundesliga|serie a|super bowl|playoff|championship|tournament|grand slam|wimbledon|us open|french open|australian open|formula 1|\bf1\b|golf|pga|masters|nascar|mma|\bufc\b|boxing|wrestling|olympic|athlete|quarterback|touchdown|homerun|hat.trick|match winner|season winner/)) return 'SPORTS';
  if (tagLabels.some((l) => l.includes('ai') || l.includes('artificial intelligence') || l.includes('tech') || l.includes('technology') || l.includes('software') || l.includes('machine learning')) ||
      q.match(/\bai\b|artificial intelligence|openai|chatgpt|\bgpt\b|anthropic|\bclaude\b|gemini|\bllm\b|large language model|machine learning|deep learning|neural network|model release|model launch|agent\b|robotics|\bnvidia\b|semiconductor|chip\b|apple|google|meta\b|microsoft|amazon|tesla|spacex|elon musk|sam altman|tech company|silicon valley|startup|software|app store|smartphone|iphone|android/)) return 'AI/TECH';

  return 'OTHER';
}

const PAGE_SIZE = 100;
const TARGET_MARKETS = 500;

export async function fetchPolymarkets(): Promise<NormalisedMarket[]> {
  const allMarkets: GammaMarket[] = [];

  for (let offset = 0; offset < TARGET_MARKETS; offset += PAGE_SIZE) {
    const url = `${GAMMA_API}/markets?active=true&closed=false&limit=${PAGE_SIZE}&offset=${offset}&order=volume&ascending=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Gamma API error: ${res.status}`);
    const page = await res.json() as GammaMarket[];
    allMarkets.push(...page);
    if (page.length < PAGE_SIZE) break; // no more pages
  }

  const markets = allMarkets;
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
