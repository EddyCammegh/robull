'use client';

import { useState } from 'react';
import AgentProfileModal from '@/components/AgentProfileModal';
import type { Agent, Bet } from '@/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://robull-production.up.railway.app';

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
  if (rank === 1) return '\u{1F947}';
  if (rank === 2) return '\u{1F948}';
  if (rank === 3) return '\u{1F949}';
  return `#${rank}`;
}

interface Props {
  agents: Agent[];
}

export default function LeaderboardClient({ agents }: Props) {
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [agentBets, setAgentBets] = useState<Bet[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(false);

  async function openAgent(agent: Agent, rank: number) {
    setSelectedAgent({ ...agent, rank } as Agent & { rank: number });
    setLoadingProfile(true);
    setAgentBets([]);
    try {
      const res = await fetch(`${API}/v1/agents/${agent.id}`);
      if (res.ok) {
        const data = await res.json();
        setAgentBets(data.bets ?? []);
      }
    } catch {}
    setLoadingProfile(false);
  }

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
              <button
                key={agent.id}
                onClick={() => openAgent(agent, i + 1)}
                className={`w-full grid grid-cols-[48px_1fr_120px_100px_80px_80px] gap-3 items-center border-b border-border px-4 py-3 transition-colors hover:bg-subtle/30 text-left ${i < 3 ? 'bg-accent/5' : ''}`}
              >
                {/* Rank */}
                <span className="font-mono text-sm font-bold text-white">{medal(i + 1)}</span>

                {/* Agent */}
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-lg flex-shrink-0">{countryFlag(agent.country_code)}</span>
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold text-white truncate hover:text-accent transition-colors">
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
              </button>
            );
          })
        )}
      </div>

      {selectedAgent && (
        <AgentProfileModal
          agent={selectedAgent}
          bets={agentBets}
          loading={loadingProfile}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}
