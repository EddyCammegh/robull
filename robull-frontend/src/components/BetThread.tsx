'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';
import type { Bet } from '@/types';

function countryFlag(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

interface ThreadNode {
  bet: Bet;
  replies: ThreadNode[];
}

/** Build tree structure from flat bet list */
export function buildThreads(bets: Bet[]): ThreadNode[] {
  const byId = new Map<string, ThreadNode>();
  const roots: ThreadNode[] = [];

  // Create nodes
  for (const bet of bets) {
    byId.set(bet.id, { bet, replies: [] });
  }

  // Link parents
  for (const bet of bets) {
    const node = byId.get(bet.id)!;
    if (bet.parent_bet_id && byId.has(bet.parent_bet_id)) {
      byId.get(bet.parent_bet_id)!.replies.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ── Single bet entry ─────────────────────────────────────────────────────────

function BetEntry({ bet, compact }: { bet: Bet; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const reasoning = bet.reasoning ?? '';
  const LIMIT = compact ? 150 : 200;
  const isLong = reasoning.length > LIMIT;
  const outcomeLabel = (bet as any).outcome_label ?? bet.outcome_name ?? `Outcome ${bet.outcome_index}`;
  const won = bet.settled && bet.gns_returned != null && bet.gns_returned > bet.gns_wagered;
  const lost = bet.settled && bet.gns_returned != null && bet.gns_returned <= bet.gns_wagered;

  return (
    <div className="space-y-1.5">
      {/* Agent header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm flex-shrink-0">{countryFlag(bet.country_code ?? 'XX')}</span>
        <span className="font-mono text-xs font-semibold text-white">{bet.agent_name}</span>
        <span className="font-mono text-[10px] text-muted">
          {bet.org}{bet.org && bet.model ? ' · ' : ''}{bet.model}
        </span>
        <span className="ml-auto flex items-center gap-2 flex-shrink-0">
          {won && (
            <span className="rounded bg-green-500/15 border border-green-500/40 px-1.5 py-0.5 font-mono text-[9px] font-bold text-green-400">
              WON +{Math.round(bet.gns_returned!)} GNS
            </span>
          )}
          {lost && (
            <span className="rounded bg-red-500/15 border border-red-500/40 px-1.5 py-0.5 font-mono text-[9px] font-bold text-red-400">
              LOST
            </span>
          )}
          <span className="rounded bg-accent/10 border border-accent/30 px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent">
            {outcomeLabel}
          </span>
          <span className="font-mono text-[10px] text-muted">{bet.gns_wagered.toLocaleString()} GNS</span>
          <span className="font-mono text-[10px] text-muted">{bet.confidence}%</span>
        </span>
      </div>

      {/* Confidence bar + time */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-subtle overflow-hidden">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${bet.confidence}%` }} />
        </div>
        <span className="font-mono text-[10px] text-muted flex-shrink-0">
          {formatDistanceToNow(new Date(bet.created_at), { addSuffix: true })}
        </span>
      </div>

      {/* Reasoning */}
      <div>
        <p className="font-body text-sm leading-relaxed text-gray-300">
          {isLong && !expanded ? `${reasoning.slice(0, LIMIT)}...` : reasoning}
        </p>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 font-mono text-xs text-accent hover:text-accent-dim"
          >
            {expanded ? 'COLLAPSE' : 'READ MORE'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Thread node renderer ─────────────────────────────────────────────────────

function ThreadNodeView({ node, defaultExpanded }: { node: ThreadNode; defaultExpanded: boolean }) {
  const [showReplies, setShowReplies] = useState(defaultExpanded);
  const replyCount = node.replies.length;
  const isReply = !!node.bet.reply_type;

  return (
    <div>
      {/* The bet card */}
      <div className="rounded bg-[#0f0f0f] border border-border p-3">
        {/* Reply badge */}
        {isReply && node.bet.reply_to_agent && (
          <div className="flex items-center gap-1.5 mb-2">
            <span className="font-mono text-[10px] text-muted">↩</span>
            <span className={clsx(
              'rounded px-1.5 py-0.5 font-mono text-[9px] font-bold border',
              node.bet.reply_type === 'agree'
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            )}>
              {node.bet.reply_type === 'agree' ? 'AGREES' : 'DISAGREES'}
            </span>
            <span className="font-mono text-[10px] text-muted">with {node.bet.reply_to_agent}</span>
          </div>
        )}

        <BetEntry bet={node.bet} compact={isReply} />

        {/* Reply count toggle */}
        {replyCount > 0 && !showReplies && (
          <button
            onClick={() => setShowReplies(true)}
            className="mt-2 font-mono text-[10px] text-accent hover:text-accent-dim"
          >
            View {replyCount} {replyCount === 1 ? 'reply' : 'replies'} ▼
          </button>
        )}
        {replyCount > 0 && showReplies && (
          <button
            onClick={() => setShowReplies(false)}
            className="mt-2 font-mono text-[10px] text-muted hover:text-accent"
          >
            Hide replies ▲
          </button>
        )}
      </div>

      {/* Reply thread with vertical line */}
      {showReplies && replyCount > 0 && (
        <div className="ml-4 border-l-2 border-accent/30 pl-4 mt-1 space-y-1">
          {node.replies.map((reply) => (
            <ThreadNodeView key={reply.bet.id} node={reply} defaultExpanded={defaultExpanded} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Public API ───────────────────────────────────────────────────────────────

interface BetThreadProps {
  bets: Bet[];
  defaultExpanded?: boolean;
}

/** Render bets as Reddit-style threaded conversations */
export default function BetThread({ bets, defaultExpanded = false }: BetThreadProps) {
  const threads = buildThreads(bets);

  if (threads.length === 0) {
    return <p className="font-mono text-[10px] text-muted py-4 text-center">No agent bets yet.</p>;
  }

  return (
    <div className="space-y-2">
      {threads.map((node) => (
        <ThreadNodeView key={node.bet.id} node={node} defaultExpanded={defaultExpanded} />
      ))}
    </div>
  );
}
