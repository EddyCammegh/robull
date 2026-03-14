'use client';

import Link from 'next/link';
import clsx from 'clsx';
import type { Bet, Agent } from '@/types';

function countryFlag(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

interface SidebarProps {
  topAgents: Agent[];
  recentBets: Bet[];
  activeCategory?: string;
  activeKeyword?: string;
  activeAgent?: string;
  onFilterChange?: (keyword: string) => void;
  onCategoryChange?: (category: string) => void;
  onAgentChange?: (agentId: string) => void;
}

const CATEGORIES = ['ALL', 'MACRO', 'POLITICS', 'CRYPTO', 'SPORTS', 'AI/TECH', 'OTHER'];

export default function Sidebar({
  topAgents,
  recentBets,
  activeCategory = '',
  activeKeyword = '',
  activeAgent = '',
  onFilterChange,
  onCategoryChange,
  onAgentChange,
}: SidebarProps) {
  return (
    <aside className="space-y-6">
      {/* Keyword search */}
      <div className="card p-4">
        <h3 className="font-mono text-xs font-bold text-muted uppercase tracking-widest mb-3">
          SEARCH
        </h3>
        <input
          type="text"
          placeholder="Filter by keyword..."
          value={activeKeyword}
          onChange={(e) => onFilterChange?.(e.target.value)}
          className="w-full rounded bg-surface border border-border px-3 py-2 font-mono text-xs text-white placeholder-muted focus:border-accent focus:outline-none transition-colors"
        />
      </div>

      {/* Category filters */}
      <div className="card p-4">
        <h3 className="font-mono text-xs font-bold text-muted uppercase tracking-widest mb-3">
          CATEGORIES
        </h3>
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((cat) => {
            const value = cat === 'ALL' ? '' : cat;
            const isActive = activeCategory === value;
            return (
              <button
                key={cat}
                onClick={() => onCategoryChange?.(value)}
                className={clsx(
                  'rounded px-2 py-1 font-mono text-[10px] font-semibold border transition-colors',
                  isActive
                    ? 'bg-accent border-accent text-white'
                    : 'text-muted border-border hover:border-accent hover:text-accent'
                )}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Top agents — clickable to filter feed */}
      <div className="card p-4">
        <h3 className="font-mono text-xs font-bold text-muted uppercase tracking-widest mb-3">
          TOP AGENTS
        </h3>
        <div className="space-y-1">
          {topAgents.slice(0, 5).map((agent, i) => {
            const isActive = activeAgent === agent.id;
            return (
              <button
                key={agent.id}
                onClick={() => onAgentChange?.(isActive ? '' : agent.id)}
                className={clsx(
                  'w-full flex items-center gap-2 rounded px-2 py-1.5 transition-colors text-left',
                  isActive ? 'bg-accent/10 border border-accent/30' : 'hover:bg-subtle/30'
                )}
              >
                <span className="font-mono text-xs text-muted w-4 flex-shrink-0">{i + 1}</span>
                <span className="text-sm flex-shrink-0">{countryFlag(agent.country_code)}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-white truncate">{agent.name}</p>
                  <p className="font-mono text-[10px] text-muted truncate">{agent.model}</p>
                </div>
                <span className={clsx(
                  'font-mono text-xs font-semibold flex-shrink-0',
                  (agent.roi ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
                )}>
                  {(agent.roi ?? 0) >= 0 ? '+' : ''}{(agent.roi ?? 0).toFixed(1)}%
                </span>
              </button>
            );
          })}
        </div>
        <Link
          href="/leaderboard"
          className="mt-2 block font-mono text-[10px] text-muted hover:text-accent text-center transition-colors"
        >
          VIEW FULL LEADERBOARD →
        </Link>
      </div>

      {/* Hot markets */}
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
    </aside>
  );
}
