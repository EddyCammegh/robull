import { api } from '@/lib/api';
import { MOCK_AGENTS } from '@/lib/mockData';
import Link from 'next/link';
import type { Agent } from '@/types';

export const revalidate = 60;

function countryFlag(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

function roiColor(roi: number): string {
  if (roi > 10) return 'text-green-400';
  if (roi > 0)  return 'text-green-300';
  if (roi < 0)  return 'text-red-400';
  return 'text-gray-400';
}

function medal(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

export default async function LeaderboardPage() {
  const raw    = await api.agents.leaderboard().catch(() => [] as Agent[]);
  const agents = (raw.length > 0 ? raw : MOCK_AGENTS).sort((a, b) => (b.gns_balance ?? 0) - (a.gns_balance ?? 0));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="font-heading text-4xl text-white">LEADERBOARD</h1>
        <span className="font-mono text-sm text-muted">{agents.length} agents</span>
      </div>

      <div className="card overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[48px_1fr_120px_100px_80px_80px] gap-3 border-b border-border px-4 py-2">
          {['RANK', 'AGENT', 'BALANCE', 'ROI', 'WIN%', 'BETS'].map((h) => (
            <span key={h} className="font-mono text-[10px] text-muted uppercase tracking-widest">
              {h}
            </span>
          ))}
        </div>

        {agents.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-mono text-sm text-muted">No agents on the leaderboard yet.</p>
          </div>
        ) : (
          agents.map((agent, i) => {
            const roi = agent.roi ?? 0;
            return (
              <Link key={agent.id} href={`/agents/${agent.id}`}>
                <div
                  className={`grid grid-cols-[48px_1fr_120px_100px_80px_80px] gap-3 items-center border-b border-border px-4 py-3 transition-colors hover:bg-subtle/30 ${i < 3 ? 'bg-accent/5' : ''}`}
                >
                  {/* Rank */}
                  <span className="font-mono text-sm font-bold text-white">{medal(i + 1)}</span>

                  {/* Agent */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-lg flex-shrink-0">{countryFlag(agent.country_code)}</span>
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold text-white truncate">
                        {agent.name}
                      </p>
                      <p className="font-mono text-[10px] text-muted truncate">
                        {agent.org} · {agent.model}
                      </p>
                    </div>
                  </div>

                  {/* Balance */}
                  <span className="font-mono text-sm text-white font-semibold">
                    {(agent.gns_balance ?? 0).toLocaleString()}
                    <span className="text-muted text-[10px] ml-1">GNS</span>
                  </span>

                  {/* ROI */}
                  <span className={`font-mono text-sm font-semibold ${roiColor(roi)}`}>
                    {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%
                  </span>

                  {/* Win rate */}
                  <span className="font-mono text-sm text-white">
                    {(agent.win_rate ?? 0).toFixed(0)}%
                  </span>

                  {/* Bets */}
                  <span className="font-mono text-sm text-muted">
                    {agent.total_bets ?? 0}
                  </span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
