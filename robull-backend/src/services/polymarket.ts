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

// ─── Sports: checked FIRST to catch team names / match formats before other rules ──
// "vs." patterns, "win on 2026-", "O/U" lines are strong sports signals.
const SPORTS_RE = new RegExp([
  // Leagues & tournaments
  /\bnba\b/, /\bnfl\b/, /\bnhl\b/, /\bmlb\b/, /\bmls\b/, /\bfifa\b/, /\bepl\b/, /\bucl\b/,
  /world cup/, /champions league/, /premier league/, /la liga/, /bundesliga/, /serie a/,
  /ligue 1/, /super bowl/, /playoff/, /championship\b/, /\btournament\b/,
  /grand slam/, /wimbledon/, /us open/, /french open/, /australian open/,
  /formula 1/, /\bf1\b/, /\bgolf\b/, /\bpga\b/, /\bmasters\b/, /nascar/,
  /\bmma\b/, /\bufc\b/, /\bboxing\b/, /\bolympic/, /\bcricket\b/, /\brugby\b/, /\btennis\b/,
  /carabao cup/, /\bfa cup\b/, /\befl\b/, /league cup/,
  /promotion/, /relegation/, /\btransfer\b/, /manager sacked/,
  /match winner/, /season winner/, /top scorer/, /\bmvp\b/, /\bdraft\b/,
  // Match‑style patterns: "Team vs. Team", "Will <Team> win on <date>"
  /\bvs\.?\s/, /\bwin on \d{4}/, /\bo\/u\s?\d/,
  // Specific club / team suffixes that appear in Polymarket questions
  /\bfc\b/, /\bcf\b/, /\bafc\b/, /\bsc\b.*(?:win|match|season)/,
  // Well‑known team / league names that don't contain dangerous substrings
  /nuggets/, /lakers/, /celtics/, /clippers/, /76ers/, /wizards/, /nets\b/,
  /devils/, /kings\b.*(?:vs|win|match)/, /padres/, /diamondbacks/,
  /arsenal/, /real madrid/, /manchester/, /liverpool/, /chelsea/, /tottenham/,
  /barcelona/, /juventus/, /bayern/, /inter miami/, /philadelphia union/,
  /sunderland/, /hoffenheim/, /hamburger sv/, /sevilla/, /lyon(?:nais)?/,
  /hellas verona/, /mallorca/, /valencia/, /sporting\b.*(?:win|champion)/,
  /midtjylland/, /henan/, /getafe/, /genoa/,
  /alcaraz/, /medvedev/, /bnp paribas open/,
].map(r => r.source).join('|'), 'i');

const POLITICS_RE = new RegExp([
  // Institutions & processes
  /election/, /\bpresident/, /prime minister/, /\bsenator?\b/, /\bcongress/,
  /parliament/, /\bvote\b/, /\bballot\b/, /\bdemocrat/, /\brepublican/,
  /political party/, /government/, /\bminister\b/, /\bchancellor\b/,
  /\bmayor\b/, /\bgovernor\b/, /\bnato\b/, /\bsanctions\b/,
  /\bceasefire\b/, /\btreaty\b/, /\bdiplomat/, /\bregime\b/, /\bcoup\b/,
  /\bwar\b/, /\bconflict\b/, /\bgeopolit/,
  /white house/, /cabinet\b/, /legislation/, /impeach/, /\bveto\b/,
  /scotus/, /supreme court/,
  // Countries / regions (geopolitical context)
  /\bukraine\b/, /\brussia\b/, /\bchina\b/, /\btaiwan\b/, /\biran\b/,
  /\bisrael\b/, /\bgaza\b/, /\bhamas\b/, /\bcuba\b/, /\bgreenland\b/,
  // Politician names
  /\btrump\b/, /\bbiden\b/, /\bharris\b/, /\bobama\b/, /\bclinton\b/,
  /\bputin\b/, /\bzelensky\b/, /\bxi jinping\b/, /\bmodi\b/, /\bmacron\b/,
  /\bstarmer\b/, /\bsunak\b/, /\bbadenoch\b/, /\bmerkel\b/, /\bscholz\b/,
  /\bmeloni\b/, /\berdogan\b/, /\bkhamenei\b/, /\bnetanyahu\b/, /\babbas\b/,
  /\bmilei\b/, /\blula\b/, /\bbolsonaro\b/, /\btrudeau\b/,
  /\balbanese\b/, /\bardern\b/, /\bjohnson\b.*(?:prime|politics|elect)/,
  /\bfarage\b/, /\ble pen\b/, /\borban\b/, /\bkim jong un\b/,
  /\bmaduro\b/, /\bcastro\b/, /\blukashenko\b/, /\bmbs\b/, /\bbin salman\b/,
  /\bsisi\b/, /\bkagame\b/, /\bramaphosa\b/, /\bpetro\b.*(?:leader|colombia|president|out)/,
  /van duyne/,
  /balance of power/,
].map(r => r.source).join('|'), 'i');

const CRYPTO_RE = new RegExp([
  /\bbitcoin\b/, /\bbtc\b/, /\bethereum\b/, /\bcrypto\b/, /\bblockchain\b/,
  /\bdefi\b/, /\bnft\b/, /\bstablecoin\b/, /\busdc\b/, /\busdt\b/, /\btether\b/,
  /\bcoinbase\b/, /\bbinance\b/,
  /\baltcoin\b/, /\bmemecoin\b/, /\bairdrop\b/, /\bwallet\b/, /\bweb3\b/,
  /\bon-chain\b/, /\bl1\b/, /\bl2\b/, /\bprotocol\b/,
  /\bfdv\b/, /launch token/, /token launch/,
  /\bsolana\b/, /\bxrp\b/, /\bripple\b/, /\bcardano\b/,
  /\bavalanche\b/, /\bavax\b/, /\bpolygon\b/, /\bmatic\b/,
  /\bchainlink\b/, /\buniswap\b/, /\baave\b/,
  /\bdogecoin\b/, /\bdoge\b/, /\bshiba\b/, /\bbnb\b/,
  /\bkraken\b/, /\bbybit\b/, /\bmicrostrategy\b/, /\bbitboy\b/,
  /\bmegaeth\b/, /\bedgex\b/, /predict\.fun/,
  // "market cap" only in crypto context (near token-like words)
  /market cap/,
].map(r => r.source).join('|'), 'i');

const MACRO_RE = new RegExp([
  /federal reserve/, /\bthe fed\b/, /\bfed\b.*(?:rate|cut|hike|meeting|funds|policy)/,
  /interest rate/, /\binflation\b/, /\bcpi\b/, /\bgdp\b/, /\brecession\b/,
  /\bunemployment\b/, /\bpowell\b/, /\bfomc\b/,
  /\btreasury\b/, /bond yield/, /\bs&p\b/, /\bnasdaq\b/, /dow jones/,
  /stock market/, /\bipo\b/, /\bearnings\b/,
  /\btariff/, /trade war/, /\bdeficit\b/, /debt ceiling/,
  /\bimf\b/, /world bank/, /monetary policy/, /\bfiscal\b/,
  /\boil price\b/, /\bcrude oil\b/, /\bcrude\b.*\$/, /\bgold price\b/, /\bcommodity\b/,
  /\bmsci\b/, /\bdelisted\b/,
].map(r => r.source).join('|'), 'i');

const AITECH_RE = new RegExp([
  /artificial intelligence/,
  /\bopenai\b/, /\bchatgpt\b/, /\bgpt[-‑]?\d/, /\banthropic\b/, /\bclaude\b/,
  /\bgemini\b.*(?:ai|model|google)/, /\bllm\b/, /large language model/,
  /machine learning/, /deep learning/, /neural network/, /model release/,
  /\bnvidia\b/, /semiconductor/,
  /\btesla\b/, /\bspacex\b/, /\belon musk\b/, /\bsam altman\b/,
  /tech company/, /silicon valley/,
  /\brobotics\b/, /\bautonomous\b/, /self[- ]driving/,
  /\bgrok\b/, /\bxai\b/, /\bmistral\b/, /\bperplexity\b/, /\bcursor\b/,
  /\bdeepseek\b/, /hugging face/, /\bagentic\b/,
  /\blovable\b/,
].map(r => r.source).join('|'), 'i');

// Specific \bai\b check — only match when it looks like "artificial intelligence" context,
// not words like "said", "aimed", etc. Require standalone "AI" (uppercase) or surrounded by
// tech-adjacent words.
function looksLikeAI(question: string): boolean {
  // Uppercase "AI" as a standalone word is almost always artificial intelligence
  if (/\bAI\b/.test(question)) return true;
  return false;
}

function classifyCategory(question: string, tags?: { label: string }[]): MarketCategory {
  const tagLabels = (tags ?? []).map((t) => t.label.toLowerCase());

  // ── Sports first: catches team names, "vs.", "win on <date>" before other rules
  // can misfire on substrings like "eth" in "Beth", "sol" in "Solana" etc.
  if (tagLabels.some((l) => /sport|nba|nfl|soccer|football|baseball|hockey|tennis|golf|cricket|rugby/.test(l)) ||
      SPORTS_RE.test(question)) return 'SPORTS';

  // ── Politics: geopolitical events, elections, named politicians
  if (tagLabels.some((l) => /politic|election|president|parliament|government/.test(l)) ||
      POLITICS_RE.test(question)) return 'POLITICS';

  // ── Crypto
  if (tagLabels.some((l) => /crypto|bitcoin|ethereum|solana|blockchain|defi/.test(l)) ||
      CRYPTO_RE.test(question)) return 'CRYPTO';

  // ── Macro / economics
  if (tagLabels.some((l) => /macro|econom|fed\b|finance/.test(l)) ||
      MACRO_RE.test(question)) return 'MACRO';

  // ── AI / Tech
  if (tagLabels.some((l) => /\bai\b|artificial intelligence|tech|software|machine learning/.test(l)) ||
      AITECH_RE.test(question) || looksLikeAI(question)) return 'AI/TECH';

  return 'OTHER';
}

const PAGE_SIZE = 100;
const TARGET_MARKETS = 2000;

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
