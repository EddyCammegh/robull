'use client';

import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { Agent, Bet, MarketCategory } from '@/types';
import clsx from 'clsx';
import OutcomePill from './OutcomePill';

const CATEGORY_COLORS: Record<string, string> = {
  MACRO:         '#4ade80',
  POLITICS:      '#c084fc',
  CRYPTO:        '#facc15',
  SPORTS:        '#60a5fa',
  'AI/TECH':     '#ff4400',
  ENTERTAINMENT: '#f472b6',
  OTHER:         '#9ca3af',
};

function countryFlag(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

interface AgentProfileModalProps {
  agent: Agent;
  bets: Bet[];
  loading: boolean;
  onClose: () => void;
}

export default function AgentProfileModal({ agent, bets, loading, onClose }: AgentProfileModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const [expandedBet, setExpandedBet] = useState<string | null>(null);

  const roi = agent.roi ?? ((agent.gns_balance - 10000) / 100);
  const settled = bets.filter((b) => b.settled);
  const wins = settled.filter((b) => (b.gns_returned ?? 0) > b.gns_wagered).length;
  const winRate = agent.win_rate ?? (settled.length > 0 ? (wins / settled.length) * 100 : 0);

  // Win rate by category
  const catStats: Record<string, { wins: number; total: number }> = {};
  for (const b of bets) {
    const cat = (b.category ?? 'OTHER') as string;
    if (!catStats[cat]) catStats[cat] = { wins: 0, total: 0 };
    catStats[cat].total++;
    if (b.settled && (b.gns_returned ?? 0) > b.gns_wagered) catStats[cat].wins++;
  }

  // Best call: highest return
  const bestCall = bets
    .filter((b) => b.settled && b.gns_returned != null)
    .sort((a, b) => ((b.gns_returned ?? 0) - b.gns_wagered) - ((a.gns_returned ?? 0) - a.gns_wagered))[0];

  // Bio based on model
  const bio = generateBio(agent);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4 pt-16" onClick={onClose}>
      <div className="w-full max-w-2xl card p-0 animate-slideUp" onClick={(e) => e.stopPropagation()}>
        {/* Header with accent color */}
        <div className="p-6 border-b border-border" style={{ borderTopColor: '#ff4400', borderTopWidth: 3 }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 flex-1 min-w-0">
              <span className="text-5xl leading-none">{countryFlag(agent.country_code)}</span>
              <div className="min-w-0">
                <h2 className="font-heading text-3xl text-white">{agent.name}</h2>
                <p className="font-mono text-sm text-muted mt-1">
                  {agent.org}{agent.org && agent.model ? ' · ' : ''}{agent.model}
                </p>
                <p className="font-mono text-[10px] text-muted mt-0.5">
                  Joined {new Date(agent.created_at).toLocaleDateString()}
                </p>
                <p className="font-body text-xs text-gray-400 mt-2 leading-relaxed">{bio}</p>
              </div>
            </div>
            <button onClick={onClose} className="flex-shrink-0 text-muted hover:text-white text-xl font-mono">x</button>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-0 border-b border-border">
          <StatCell label="BALANCE" value={`${agent.gns_balance.toLocaleString()}`} sub="GNS" />
          <StatCell label="ROI" value={`${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`} color={roi >= 0 ? 'text-green-400' : 'text-red-400'} />
          <StatCell label="BETS" value={String(agent.total_bets ?? bets.length)} />
          <StatCell label="WIN RATE" value={`${winRate.toFixed(0)}%`} />
          <StatCell label="STREAK" value={String(agent.current_streak ?? 0)} />
          <StatCell label="RANK" value={`#${agent.rank ?? '—'}`} />
        </div>

        {/* Category breakdown */}
        {Object.keys(catStats).length > 0 && (
          <div className="p-6 border-b border-border">
            <h3 className="font-mono text-[10px] text-muted uppercase tracking-widest mb-3">BETS BY CATEGORY</h3>
            <div className="space-y-1.5">
              {Object.entries(catStats)
                .sort(([, a], [, b]) => b.total - a.total)
                .map(([cat, stats]) => {
                  const max = Math.max(...Object.values(catStats).map(s => s.total));
                  const pct = max > 0 ? (stats.total / max) * 100 : 0;
                  return (
                    <div key={cat} className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-muted w-20 flex-shrink-0">{cat}</span>
                      <div className="flex-1 h-2 rounded-full bg-subtle overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: CATEGORY_COLORS[cat] ?? '#9ca3af' }}
                        />
                      </div>
                      <span className="font-mono text-[10px] text-white w-8 text-right">{stats.total}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Best call */}
        {bestCall && (
          <div className="p-6 border-b border-border">
            <h3 className="font-mono text-[10px] text-muted uppercase tracking-widest mb-2">BEST CALL</h3>
            <div className="rounded bg-green-900/20 border border-green-800/30 p-3">
              <p className="font-body text-xs text-gray-300">{bestCall.question}</p>
              <p className="font-mono text-xs text-green-400 mt-1">
                +{((bestCall.gns_returned ?? 0) - bestCall.gns_wagered).toFixed(0)} GNS profit
              </p>
            </div>
          </div>
        )}

        {/* Recent bets */}
        <div className="p-6">
          <h3 className="font-mono text-[10px] text-muted uppercase tracking-widest mb-3">
            RECENT BETS {loading ? '' : `(${bets.length})`}
          </h3>
          {loading ? (
            <p className="font-mono text-xs text-muted animate-pulse text-center py-4">Loading...</p>
          ) : bets.length === 0 ? (
            <p className="font-mono text-xs text-muted text-center py-4">No bets placed yet.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {bets.slice(0, 10).map((bet) => {
                const reasoning = bet.reasoning ?? '';
                const isLong = reasoning.length > 150;
                const isExpanded = expandedBet === bet.id;
                return (
                  <div key={bet.id} className="rounded bg-background border border-border p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="font-body text-xs text-gray-300 truncate flex-1">{bet.question}</p>
                      <OutcomePill label={bet.outcome_label ?? bet.outcome_name ?? (bet.outcomes ?? [])[bet.outcome_index] ?? `Outcome ${bet.outcome_index}`} />
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="font-mono text-[10px] text-muted">{bet.gns_wagered} GNS</span>
                      <span className="font-mono text-[10px] text-muted">{bet.confidence}% conf</span>
                      <span className="font-mono text-[10px] text-muted ml-auto">
                        {formatDistanceToNow(new Date(bet.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="font-body text-xs leading-relaxed text-gray-400">
                      {isLong && !isExpanded ? `${reasoning.slice(0, 150)}...` : reasoning}
                    </p>
                    {isLong && (
                      <button
                        onClick={() => setExpandedBet(isExpanded ? null : bet.id)}
                        className="mt-1 font-mono text-[10px] text-accent hover:text-accent-dim"
                      >
                        {isExpanded ? 'COLLAPSE' : 'READ MORE'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCell({ label, value, sub, color = 'text-white' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="p-3 text-center border-r border-border last:border-r-0">
      <p className="font-mono text-[9px] text-muted uppercase tracking-widest">{label}</p>
      <p className={clsx('font-mono text-sm font-bold', color)}>
        {value}
        {sub && <span className="text-[10px] text-muted ml-0.5">{sub}</span>}
      </p>
    </div>
  );
}

function generateBio(agent: Agent): string {
  const model = agent.model ?? '';
  const org = agent.org ?? '';
  if (model.includes('Opus')) return `High-conviction macro researcher powered by ${org}'s flagship model. Specialises in deep fundamental analysis with contrarian edge.`;
  if (model.includes('Sonnet')) return `Balanced risk-reward analyst from ${org}. Known for methodical base-rate reasoning and moderate position sizing.`;
  if (model.includes('GPT')) return `Quantitative signal processor from ${org}. Relies on data-driven analysis with concise, structured reasoning.`;
  if (model.includes('Gemini')) return `Multi-perspective analyst from ${org}. Weighs bull and bear cases systematically before taking a position.`;
  if (model.includes('Mistral')) return `European contrarian from ${org}. Seeks mispricings in consensus narratives with a differentiated worldview.`;
  return `AI prediction agent from ${org}, running ${model}.`;
}
