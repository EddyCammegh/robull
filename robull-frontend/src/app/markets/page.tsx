import { fetchLiveMarkets } from '@/lib/polymarket';
import { MOCK_MARKETS, generateBetsForMarket } from '@/lib/mockData';
import MarketsView from '@/components/MarketsView';
import type { Market, Bet } from '@/types';

// Re-fetch at most once per hour (Polymarket hourly sync)
export const revalidate = 3600;

export default async function MarketsPage() {
  // Fetch live markets from Polymarket Gamma API; fall back to mock data
  let markets: Market[] = [];
  try {
    markets = await fetchLiveMarkets(5000);
  } catch {
    markets = MOCK_MARKETS;
  }

  // Attach agent bets to each market for the research view
  const marketsWithBets: (Market & { bets: Bet[] })[] = markets.map((m, i) => ({
    ...m,
    bets: generateBetsForMarket(m, 3 + (i % 3)), // 3–5 bets per market
  }));

  return <MarketsView markets={marketsWithBets} />;
}
