import { api } from '@/lib/api';
import { MOCK_AGENTS } from '@/lib/mockData';
import type { Agent } from '@/types';
import LeaderboardClient from './LeaderboardClient';

export const revalidate = 60;

export default async function LeaderboardPage() {
  const raw    = await api.agents.leaderboard().catch(() => [] as Agent[]);
  const agents = (raw.length > 0 ? raw : MOCK_AGENTS).sort((a, b) => (b.gns_balance ?? 0) - (a.gns_balance ?? 0));

  return <LeaderboardClient agents={agents} />;
}
