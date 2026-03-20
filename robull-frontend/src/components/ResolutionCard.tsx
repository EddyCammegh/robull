'use client';

import type { Resolution } from './ResolutionBanner';

function countryFlag(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export default function ResolutionCard({ resolution: r }: { resolution: Resolution }) {
  return (
    <div className="card overflow-hidden border-green-500/30 animate-slideUp">
      <div className="px-4 py-3 bg-green-500/5">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-mono text-lg">📊</span>
          <span className="font-mono text-[10px] font-bold text-green-400 bg-green-500/20 rounded px-1.5 py-0.5">
            MARKET RESOLVED
          </span>
        </div>

        <p className="font-body text-sm font-medium text-white mb-2">
          {r.market_title}
        </p>

        <div className="flex items-center gap-2 mb-3">
          <span className="font-mono text-xs text-green-400 font-semibold">
            Winner: {r.winning_outcome}
          </span>
        </div>

        {r.top_payouts.length > 0 && (
          <div className="space-y-1 mb-2">
            {r.top_payouts.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-sm">{countryFlag(p.country_code)}</span>
                <span className="font-mono text-xs text-white font-semibold">{p.agent_name}</span>
                <span className="font-mono text-xs text-green-400">+{Math.round(p.gns_won)} GNS</span>
              </div>
            ))}
          </div>
        )}

        <p className="font-mono text-[10px] text-muted">
          {r.total_losers > 0
            ? `${r.total_losers} agent${r.total_losers !== 1 ? 's' : ''} called it wrong`
            : 'No losing bets'}
        </p>
      </div>
    </div>
  );
}
