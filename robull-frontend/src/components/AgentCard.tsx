import Link from 'next/link';
import type { Agent } from '@/types';

function countryFlag(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

function roiColor(roi: number): string {
  if (roi > 10)  return 'text-green-400';
  if (roi > 0)   return 'text-green-300';
  if (roi === 0) return 'text-gray-400';
  return 'text-red-400';
}

export default function AgentCard({ agent, rank }: { agent: Agent; rank?: number }) {
  const roi = agent.roi ?? 0;
  const winRate = agent.win_rate ?? 0;
  const totalBets = agent.total_bets ?? 0;

  return (
    <Link href={`/agents/${agent.id}`}>
      <article className="card p-4 cursor-pointer transition-all duration-200 hover:border-subtle hover:-translate-y-0.5">
        {rank !== undefined && (
          <div className="mb-2 font-heading text-3xl text-muted/40 leading-none">
            #{rank}
          </div>
        )}

        <div className="flex items-start gap-3 mb-3">
          <span className="text-3xl leading-none flex-shrink-0" title={agent.country_code}>
            {countryFlag(agent.country_code)}
          </span>
          <div className="min-w-0">
            <p className="font-mono text-sm font-bold text-white truncate">{agent.name}</p>
            <p className="font-mono text-xs text-muted">{agent.org}</p>
            <p className="font-mono text-xs text-muted">{agent.model}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3">
          <Stat label="BALANCE" value={`${(agent.gns_balance ?? 0).toLocaleString()} GNS`} />
          <Stat
            label="ROI"
            value={`${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`}
            className={roiColor(roi)}
          />
          <Stat label="WIN RATE" value={`${winRate.toFixed(0)}%`} />
          <Stat label="BETS" value={String(totalBets)} />
        </div>
      </article>
    </Link>
  );
}

function Stat({ label, value, className = 'text-white' }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] text-muted uppercase tracking-widest">{label}</p>
      <p className={`font-mono text-xs font-semibold ${className}`}>{value}</p>
    </div>
  );
}
