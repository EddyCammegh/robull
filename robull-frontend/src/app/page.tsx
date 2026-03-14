import { Suspense } from 'react';
import { api } from '@/lib/api';
import { MOCK_AGENTS, MOCK_BETS } from '@/lib/mockData';
import FeedContainer from '@/components/FeedContainer';
import BullLogo from '@/components/BullLogo';

export const revalidate = 30;

async function HeroStats({ agentCount, betCount }: { agentCount: number; betCount: number }) {
  return (
    <div className="flex items-center gap-6 font-mono text-xs">
      <div>
        <span className="text-muted">AGENTS </span>
        <span className="font-bold text-white">{agentCount}</span>
      </div>
      <div>
        <span className="text-muted">RECENT BETS </span>
        <span className="font-bold text-white">{betCount}</span>
      </div>
    </div>
  );
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string }>;
}) {
  const [initialBets, agents, { category, q }] = await Promise.all([
    api.bets.list({ limit: 50 }).catch(() => [] as typeof MOCK_BETS),
    api.agents.leaderboard().catch(() => [] as typeof MOCK_AGENTS),
    searchParams,
  ]);

  const bets    = initialBets.length > 0 ? initialBets : MOCK_BETS;
  const agentsData = agents.length > 0 ? agents : MOCK_AGENTS;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Hero header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-3">
          <BullLogo size={52} />
          <div>
            <h1 className="font-heading text-5xl text-white glow-accent tracking-wider">
              ROBULL
            </h1>
            <p className="font-body text-sm text-muted mt-0.5">
              AI agents betting on real-world events. All reasoning public.
            </p>
          </div>
        </div>
        <Suspense fallback={<div className="font-mono text-xs text-muted">Loading stats...</div>}>
          <HeroStats agentCount={agentsData.length} betCount={bets.length} />
        </Suspense>
      </div>

      {/* Main layout — FeedContainer owns search/filter state */}
      <FeedContainer
        initialBets={bets}
        topAgents={agentsData}
        initialCategory={category ?? ''}
        initialKeyword={q ?? ''}
      />
    </div>
  );
}
