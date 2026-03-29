import type Redis from 'ioredis';

// ── RSS Feed Sources ─────────────────────────────────────────────────────────

interface FeedSource {
  url: string;
  name: string;
  categories: string[];
}

const FEEDS: FeedSource[] = [
  // Politics
  { url: 'http://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC World', categories: ['POLITICS', 'MACRO'] },
  { url: 'https://www.theguardian.com/world/rss', name: 'Guardian', categories: ['POLITICS', 'MACRO'] },
  { url: 'https://feeds.reuters.com/reuters/worldNews', name: 'Reuters', categories: ['POLITICS', 'MACRO'] },
  { url: 'https://rss.politico.com/politics-news.xml', name: 'Politico', categories: ['POLITICS'] },
  { url: 'https://feeds.apnews.com/rss/apf-topnews', name: 'AP News', categories: ['POLITICS', 'MACRO'] },
  // Macro / Finance
  { url: 'https://feeds.bloomberg.com/markets/news.rss', name: 'Bloomberg', categories: ['MACRO'] },
  { url: 'https://www.ft.com/?format=rss', name: 'FT', categories: ['MACRO'] },
  { url: 'https://feeds.reuters.com/reuters/businessNews', name: 'Reuters Biz', categories: ['MACRO'] },
  // Crypto
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', name: 'CoinDesk', categories: ['CRYPTO'] },
  { url: 'https://decrypt.co/feed', name: 'Decrypt', categories: ['CRYPTO'] },
  { url: 'https://www.theblock.co/rss.xml', name: 'The Block', categories: ['CRYPTO'] },
  { url: 'https://cointelegraph.com/rss', name: 'CoinTelegraph', categories: ['CRYPTO'] },
  // AI / Tech
  { url: 'https://techcrunch.com/feed/', name: 'TechCrunch', categories: ['AI/TECH'] },
  { url: 'https://www.theverge.com/rss/index.xml', name: 'The Verge', categories: ['AI/TECH'] },
  { url: 'https://feeds.arstechnica.com/arstechnica/index', name: 'Ars Technica', categories: ['AI/TECH'] },
];

export interface NewsArticle {
  title: string;
  url: string;
  source: string;
  published_at: string;
  summary: string;
}

const REDIS_KEY = 'newsfeed:articles';
const CACHE_TTL = 15 * 60; // 15 minutes

// ── Simple XML tag extractor (no dependency needed) ──────────────────────────

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(xml);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

function extractItems(xml: string): string[] {
  const items: string[] = [];
  const re = /<item[\s>]([\s\S]*?)<\/item>|<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    items.push(m[1] ?? m[2]);
  }
  return items;
}

function extractLink(itemXml: string): string {
  // Atom: <link href="..." />
  const atomLink = /href="([^"]+)"/.exec(itemXml);
  // RSS: <link>...</link>
  const rssLink = extractTag(itemXml, 'link');
  return rssLink || atomLink?.[1] || '';
}

function parseRSS(xml: string, sourceName: string): NewsArticle[] {
  const items = extractItems(xml);
  return items.slice(0, 30).map((item) => ({
    title: extractTag(item, 'title').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#039;/g, "'").replace(/&quot;/g, '"'),
    url: extractLink(item),
    source: sourceName,
    published_at: extractTag(item, 'pubDate') || extractTag(item, 'published') || extractTag(item, 'updated') || new Date().toISOString(),
    summary: (extractTag(item, 'description') || extractTag(item, 'summary') || '').replace(/<[^>]+>/g, '').slice(0, 200),
  })).filter((a) => a.title && a.url);
}

// ── Fetch and cache all feeds ────────────────────────────────────────────────

export async function refreshNewsfeed(redis: Redis): Promise<void> {
  const allArticles: (NewsArticle & { categories: string[] })[] = [];

  for (const feed of FEEDS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(feed.url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Robull/1.0 News Aggregator' },
      });
      clearTimeout(timeout);

      if (!res.ok) continue;
      const xml = await res.text();
      const articles = parseRSS(xml, feed.name);
      for (const article of articles) {
        allArticles.push({ ...article, categories: feed.categories });
      }
    } catch {
      // Skip failed feeds silently
    }
  }

  if (allArticles.length > 0) {
    await redis.set(REDIS_KEY, JSON.stringify(allArticles), 'EX', CACHE_TTL);
    console.log(`[newsfeed] Cached ${allArticles.length} articles from ${FEEDS.length} feeds`);
  }
}

// ── Get cached articles ──────────────────────────────────────────────────────

async function getCachedArticles(redis: Redis): Promise<(NewsArticle & { categories: string[] })[]> {
  const cached = await redis.get(REDIS_KEY);
  if (!cached) return [];
  try {
    return JSON.parse(cached);
  } catch {
    return [];
  }
}

// ── Relevance matching ───────────────────────────────────────────────────────

function extractKeywords(title: string): string[] {
  // Remove common words, split into meaningful keywords
  const stop = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'by', 'and', 'or', 'is', 'are', 'was', 'will', 'be', 'has', 'have', 'had', 'do', 'does', 'did', 'with', 'from', 'this', 'that', 'what', 'when', 'where', 'who', 'how', 'not', 'no', 'yes', 'if', 'but', 'all', 'each', 'every', 'any', 'more', 'most', 'other', 'than', 'its', 'it', 'they', 'their', 'his', 'her', 'our', 'your']);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
}

// Expanded keyword mappings for common prediction market topics
const KEYWORD_EXPANSIONS: Record<string, string[]> = {
  bitcoin: ['btc', 'bitcoin', 'crypto', 'cryptocurrency', 'satoshi'],
  ethereum: ['eth', 'ethereum', 'defi', 'vitalik'],
  fed: ['federal reserve', 'fed', 'fomc', 'powell', 'interest rate', 'rate cut', 'rate hike'],
  trump: ['trump', 'republican', 'gop', 'maga'],
  ukraine: ['ukraine', 'zelensky', 'kyiv', 'russia', 'putin', 'donbas'],
  israel: ['israel', 'gaza', 'hamas', 'netanyahu', 'idf', 'hezbollah'],
  iran: ['iran', 'tehran', 'khamenei', 'nuclear'],
  china: ['china', 'beijing', 'xi jinping', 'pboc', 'taiwan'],
  election: ['election', 'vote', 'ballot', 'polling', 'candidate'],
  tariff: ['tariff', 'trade war', 'import duty', 'customs'],
  recession: ['recession', 'gdp', 'economic downturn', 'contraction'],
  inflation: ['inflation', 'cpi', 'pce', 'prices', 'cost of living'],
  openai: ['openai', 'chatgpt', 'gpt', 'sam altman'],
  anthropic: ['anthropic', 'claude'],
  google: ['google', 'alphabet', 'deepmind', 'gemini'],
};

function scoreRelevance(articleTitle: string, eventKeywords: string[]): number {
  const lower = articleTitle.toLowerCase();
  let score = 0;
  for (const kw of eventKeywords) {
    if (lower.includes(kw)) score += 2;
    // Check expansions
    const expansions = KEYWORD_EXPANSIONS[kw];
    if (expansions) {
      for (const exp of expansions) {
        if (lower.includes(exp)) score += 1;
      }
    }
  }
  return score;
}

export async function getRelevantArticles(
  redis: Redis,
  eventTitle: string,
  eventCategory: string,
  limit = 8,
): Promise<NewsArticle[]> {
  const articles = await getCachedArticles(redis);
  if (articles.length === 0) return [];

  const keywords = extractKeywords(eventTitle);

  // Score each article
  const scored = articles.map((a) => ({
    article: a,
    score: scoreRelevance(a.title + ' ' + a.summary, keywords),
    categoryMatch: a.categories.includes(eventCategory),
  }));

  // Sort by relevance score, then category match, then recency
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.categoryMatch !== b.categoryMatch) return a.categoryMatch ? -1 : 1;
    return new Date(b.article.published_at).getTime() - new Date(a.article.published_at).getTime();
  });

  // If top articles have score > 0, return those
  const relevant = scored.filter((s) => s.score > 0).slice(0, limit);
  if (relevant.length > 0) {
    return relevant.map((s) => s.article);
  }

  // Fallback: most recent from category
  const categoryArticles = scored
    .filter((s) => s.categoryMatch)
    .slice(0, limit);
  return categoryArticles.map((s) => s.article);
}
