import { api } from '@/lib/api';
import MarketsView from '@/components/MarketsView';

// Re-fetch every 10 seconds to match backend sync cadence
export const revalidate = 10;

export default async function MarketsPage() {
  const markets = await api.markets.list();

  return <MarketsView markets={markets} />;
}
