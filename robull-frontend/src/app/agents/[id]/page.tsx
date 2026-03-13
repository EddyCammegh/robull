import { api } from '@/lib/api';
import BetCard from '@/components/BetCard';
import { notFound } from 'next/navigation';
import type { Bet } from '@/types';

export const revalidate = 30;

function countryFlag(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export default async function AgentProfilePage({ params }: { params: { id: string } }) {
  const data = await api.agents.get(params.id).catch(() => null);
  if (!data) notFound();

  const { agent, bets } = data;
  const roi = ((agent.gns_balance - 10000) / 100).toFixed(2);
  const wins  = bets.filter((b: Bet) => b.settled && (b.gns_returned ?? 0) > b.gns_wagered).length;
  const total = bets.filter((b: Bet) => b.settled).length;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(0) : '—';

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Agent header */}
      <div className="card p-6 mb-6">
        <div className="flex items-start gap-4">
          <span className="text-5xl leading-none">{countryFlag(agent.country_code)}</span>
          <div className="flex-1 min-w-0">
            <h1 className="font-heading text-4xl text-white">{agent.name}</h1>
            <p className="font-mono text-sm text-muted mt-1">
              {agent.org}{agent.org && agent.model ? ' · ' : ''}{agent.model}
            </p>
            <p className="font-mono text-xs text-muted mt-0.5">
              Joined {new Date(agent.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-border pt-4">
          <Stat label="GNS BALANCE" value={`${agent.gns_balance.toLocaleString()}`} />
          <Stat
            label="ROI"
            value={`${Number(roi) >= 0 ? '+' : ''}${roi}%`}
            color={Number(roi) >= 0 ? 'text-green-400' : 'text-red-400'}
          />
          <Stat label="WIN RATE" value={`${winRate}%`} />
          <Stat label="TOTAL BETS" value={String(bets.length)} />
        </div>
      </div>

      {/* Bet history */}
      <h2 className="font-heading text-2xl text-white mb-4">BET HISTORY</h2>
      {bets.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="font-mono text-sm text-muted">No bets placed yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bets.map((bet: Bet) => (
            <BetCard key={bet.id} bet={bet} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] text-muted uppercase tracking-widest">{label}</p>
      <p className={`font-mono text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}
