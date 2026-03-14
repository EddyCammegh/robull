import type { Market, MarketCategory } from '@/types';

// ─── Real Polymarket Gamma API shape (verified against live API) ───────────────

interface PolyEvent {
  id: string;
  slug: string;
  title: string;
}

interface PolyRawMarket {
  id: string;
  question: string;
  conditionId?: string;
  slug: string;
  endDate?: string | null;
  endDateIso?: string | null;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  volume?: number | string;
  volumeNum?: number;
  /** JSON-encoded string: e.g. '["Yes","No"]' */
  outcomes?: string;
  /** JSON-encoded string of string prices: e.g. '["0.65","0.35"]' */
  outcomePrices?: string;
  lastTradePrice?: number | string | null;
  events?: PolyEvent[];
  restricted?: boolean;
}

// ─── Category inference from question text ────────────────────────────────────

const CATEGORY_KEYWORDS: Array<[RegExp, MarketCategory]> = [
  [/bitcoin|btc|ethereum|eth|crypto|defi|nft|blockchain|solana|binance|coinbase/i, 'CRYPTO'],
  [/election|president|senator|congress|parliament|vote|ballot|democrat|republican|trump|biden|labour|conservative|prime minister|chancellor|macron|modi|xi jinping|putin|zelensky/i, 'POLITICS'],
  [/nfl|nba|mlb|nhl|soccer|football|basketball|baseball|hockey|tennis|golf|mma|boxing|ufc|premier league|champions league|world cup|super bowl|olympics/i, 'SPORTS'],
  [/fed|federal reserve|ecb|interest rate|inflation|gdp|recession|cpi|unemployment|yield|treasury|bond|s&p|dow jones|nasdaq|ipo|m&a|merger|acquisition/i, 'MACRO'],
  [/ai|artificial intelligence|gpt|claude|gemini|openai|anthropic|google|apple|microsoft|meta|nvidia|llm|chatbot|machine learning/i, 'AI/TECH'],
];

function inferCategory(question: string): MarketCategory {
  for (const [regex, cat] of CATEGORY_KEYWORDS) {
    if (regex.test(question)) return cat;
  }
  return 'OTHER';
}

// ─── Parse helpers ────────────────────────────────────────────────────────────

function parseJsonArray(s: string | undefined): string[] {
  if (!s) return [];
  try { return JSON.parse(s) as string[]; } catch { return []; }
}

function toNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

// ─── Public fetch ─────────────────────────────────────────────────────────────

export async function fetchLiveMarkets(minVolume = 5000): Promise<Market[]> {
  const res = await fetch(
    'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100&order=volume&ascending=false',
    { next: { revalidate: 3600 } }
  );
  if (!res.ok) throw new Error(`Polymarket Gamma API → ${res.status}`);

  const raw: PolyRawMarket[] = await res.json();

  const markets: Market[] = [];

  for (const m of raw) {
    // Skip closed / archived / inactive
    if (m.closed || m.archived || m.active === false) continue;

    const vol = toNum(m.volumeNum ?? m.volume);
    if (vol < minVolume) continue;

    // Outcomes: JSON-encoded string array
    const outcomes = parseJsonArray(m.outcomes);
    if (outcomes.length === 0) continue;

    // Prices: JSON-encoded string array of decimal strings
    const priceStrings = parseJsonArray(m.outcomePrices);
    let probs = priceStrings.map(toNum);

    // Fall back to equal distribution if prices missing / wrong length
    if (probs.length !== outcomes.length) {
      probs = outcomes.map(() => 1 / outcomes.length);
    }

    // Normalise to sum = 1 (Polymarket prices can be slightly off due to spread)
    const sum = probs.reduce((a, b) => a + b, 0);
    if (sum > 0 && Math.abs(sum - 1) > 0.005) {
      probs = probs.map((p) => p / sum);
    }

    // SPLIT: contested market — none of the outcomes is heavily favoured
    const split = probs.length >= 2 && probs[0] >= 0.25 && probs[0] <= 0.75;

    // URL: use the event slug when the market belongs to a group event,
    // otherwise use the market's own slug. Both form valid Polymarket URLs.
    const eventSlug = m.events?.[0]?.slug;
    const urlSlug   = eventSlug ?? m.slug;
    const polyUrl   = `https://polymarket.com/event/${urlSlug}`;

    markets.push({
      id: m.id,
      polymarket_id: m.conditionId ?? m.id,
      question: m.question,
      category: inferCategory(m.question),
      polymarket_url: polyUrl,
      volume: vol,
      b_parameter: 100,
      outcomes,
      quantities: outcomes.map(() => 50),
      initial_probs: probs,
      current_probs: probs,
      closes_at: m.endDateIso ?? m.endDate ?? null,
      resolved: false,
      winning_outcome: null,
      bet_count: 0,
      split,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  return markets.sort((a, b) => b.volume - a.volume);
}
