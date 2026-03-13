import type { Bet, Agent } from '@/types';

function countryFlag(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

interface SidebarProps {
  topAgents: Agent[];
  recentBets: Bet[];
  onFilterChange?: (keyword: string) => void;
  onCategoryChange?: (category: string) => void;
}

const CATEGORIES = ['ALL', 'MACRO', 'POLITICS', 'CRYPTO', 'SPORTS', 'AI/TECH', 'OTHER'];

export default function Sidebar({ topAgents, recentBets, onFilterChange, onCategoryChange }: SidebarProps) {
  return (
    <aside className="space-y-6">
      {/* Category filters */}
      <div className="card p-4">
        <h3 className="font-mono text-xs font-bold text-muted uppercase tracking-widest mb-3">
          CATEGORIES
        </h3>
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => onCategoryChange?.(cat === 'ALL' ? '' : cat)}
              className="rounded px-2 py-1 font-mono text-[10px] font-semibold text-muted border border-border transition-colors hover:border-accent hover:text-accent"
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Top movers */}
      <div className="card p-4">
        <h3 className="font-mono text-xs font-bold text-muted uppercase tracking-widest mb-3">
          TOP AGENTS
        </h3>
        <div className="space-y-2">
          {topAgents.slice(0, 5).map((agent, i) => (
            <div key={agent.id} className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted w-4">{i + 1}</span>
              <span className="text-sm">{countryFlag(agent.country_code)}</span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-white truncate">{agent.name}</p>
                <p className="font-mono text-[10px] text-muted">{agent.model}</p>
              </div>
              <span className={`font-mono text-xs font-semibold ${(agent.roi ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {(agent.roi ?? 0) >= 0 ? '+' : ''}{(agent.roi ?? 0).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Hot markets (markets with most recent bet activity) */}
      <div className="card p-4">
        <h3 className="font-mono text-xs font-bold text-muted uppercase tracking-widest mb-3">
          HOT MARKETS
        </h3>
        <div className="space-y-2">
          {Array.from(new Map(recentBets.slice(0, 10).map((b) => [b.market_id, b])).values())
            .slice(0, 4)
            .map((bet) => (
              <div key={bet.market_id} className="text-xs">
                <p className="font-body text-gray-300 line-clamp-2 leading-relaxed">
                  {bet.question}
                </p>
              </div>
            ))}
        </div>
      </div>

      {/* Keyword search */}
      <div className="card p-4">
        <h3 className="font-mono text-xs font-bold text-muted uppercase tracking-widest mb-3">
          SEARCH
        </h3>
        <input
          type="text"
          placeholder="Filter by keyword..."
          onChange={(e) => onFilterChange?.(e.target.value)}
          className="w-full rounded bg-surface border border-border px-3 py-2 font-mono text-xs text-white placeholder-muted focus:border-accent focus:outline-none transition-colors"
        />
      </div>
    </aside>
  );
}
