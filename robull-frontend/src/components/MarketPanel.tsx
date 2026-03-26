'use client';

import CountdownTimer from './CountdownTimer';
import { useMarketClick } from './MarketClickProvider';
import type { Market, RobullEvent } from '@/types';

type SelectionBadge = 'closing_soon' | 'hot' | undefined;

const COLOURS = ['#FF4400', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#6B7280'];

interface OutcomeInfo {
  label: string;
  probability: number;
  isLeader: boolean;
}

function shortLabel(label: string): string {
  const dm = label.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i);
  if (dm) return dm[1].slice(0, 3) + ' ' + dm[2];
  const bm = label.match(/^by\s+(January|February|March|April|May|June|July|August|September|October|November|December)/i);
  if (bm) return 'by ' + bm[1].slice(0, 3);
  return label.length > 12 ? label.slice(0, 12) + '..' : label;
}

function getOutcomes(kind: 'market' | 'event', market?: Market, event?: RobullEvent, liveProbs?: number[]): OutcomeInfo[] {
  if (kind === 'market' && market) {
    const probs = liveProbs ?? market.current_probs ?? market.initial_probs ?? [];
    if (!market.outcomes?.length || !probs.length) return [];
    return market.outcomes.slice(0, 2).map((label, i) => ({ label, probability: probs[i] ?? 0, isLeader: i === 0 }));
  }
  if (kind === 'event' && event?.outcomes?.length) {
    return [...event.outcomes]
      .filter(o => !o.passed)
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 6)
      .map((o, i) => ({ label: o.label, probability: o.probability, isLeader: i === 0 }));
  }
  return [];
}

interface MarketPanelProps {
  kind: 'market' | 'event';
  market?: Market;
  event?: RobullEvent;
  badge?: SelectionBadge;
  liveProbs?: number[];
}

const CARD: React.CSSProperties = {
  width: '100%',
  height: 160,
  backgroundColor: '#111111',
  border: '1px solid #222222',
  borderRadius: 8,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  overflow: 'hidden',
  boxSizing: 'border-box',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'border-color 150ms',
};

const BADGE_ROW: React.CSSProperties = { height: 18, display: 'flex', alignItems: 'center', flexShrink: 0 };
const BADGE_CLOSING: React.CSSProperties = { fontSize: 10, padding: '2px 6px', borderRadius: 10, background: '#7c2d12', color: '#fed7aa', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, lineHeight: 1 };
const BADGE_HOT: React.CSSProperties = { fontSize: 10, padding: '2px 6px', borderRadius: 10, background: '#7c2d12', color: '#fb923c', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, lineHeight: 1 };

const TITLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#ffffff',
  lineHeight: 1.3,
  overflow: 'hidden',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical' as any,
  height: 32,
  flexShrink: 0,
  margin: 0,
};

const BARS_SECTION: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 3, minHeight: 0 };
const BAR_ROW: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, height: 16 };
const BAR_LABEL: React.CSSProperties = { width: 70, fontSize: 10, color: '#888', fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 };
const BAR_TRACK: React.CSSProperties = { flex: 1, height: 5, backgroundColor: '#1a1a1a', borderRadius: 3, overflow: 'hidden' };
const BAR_PCT: React.CSSProperties = { width: 30, fontSize: 10, color: '#fff', fontFamily: 'JetBrains Mono, monospace', textAlign: 'right', flexShrink: 0, fontWeight: 600 };

const FOOTER: React.CSSProperties = { height: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 };

export default function MarketPanel({ kind, market, event, badge, liveProbs }: MarketPanelProps) {
  const { openMarket, openEvent } = useMarketClick();

  const title = kind === 'market' ? market!.question : event!.title;
  const closesAt = kind === 'market' ? market!.closes_at : event!.closes_at;
  const resolved = kind === 'market' ? market!.resolved : event!.resolved;
  const betCount = kind === 'market' ? (market!.bet_count ?? 0) : (event!.bet_count ?? 0);
  const id = kind === 'market' ? market!.id : event!.id;

  const allOutcomes = getOutcomes(kind, market, event, liveProbs);
  const isBinary = allOutcomes.length <= 2;
  const isIndep = kind === 'event' && event && (event.event_type === 'independent' || event.event_type === 'sports_props');
  const maxProb = allOutcomes.length > 0 ? allOutcomes[0].probability : 1;

  // Always render exactly 3 bar slots
  const bars: (OutcomeInfo | null)[] = [
    allOutcomes[0] ?? null,
    allOutcomes[1] ?? null,
    allOutcomes[2] ?? null,
  ];
  const hiddenCount = allOutcomes.length > 3 ? allOutcomes.length - 3 : 0;

  const handleClick = () => {
    if (kind === 'market') openMarket(id, market);
    else openEvent(id);
  };

  return (
    <div
      onClick={handleClick}
      title={title}
      style={CARD}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(255,68,0,0.5)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = '#222222')}
    >
      {/* 1. Badge */}
      {badge && (
        <div style={BADGE_ROW}>
          {badge === 'closing_soon' && <span style={BADGE_CLOSING}>&#9201; CLOSING SOON</span>}
          {badge === 'hot' && <span style={BADGE_HOT}>&#128293; HOT</span>}
        </div>
      )}

      {/* 2. Title */}
      <p style={TITLE}>{title}</p>

      {/* 3. Bars */}
      <div style={BARS_SECTION}>
        {bars.map((o, i) => {
          if (!o) {
            return (
              <div key={i} style={BAR_ROW}>
                <span style={BAR_LABEL} />
                <div style={BAR_TRACK}>
                  <div style={{ height: 5, borderRadius: 3, width: '0%', background: '#333' }} />
                </div>
                <span style={BAR_PCT} />
              </div>
            );
          }
          const colour = isBinary ? (o.isLeader ? '#FF4400' : '#666') : (COLOURS[i] ?? COLOURS[5]);
          const barPct = (isBinary || isIndep)
            ? o.probability * 100
            : (maxProb > 0 ? (o.probability / maxProb) * 100 : 0);
          return (
            <div key={i} style={BAR_ROW}>
              <span style={BAR_LABEL}>{shortLabel(o.label)}</span>
              <div style={BAR_TRACK}>
                <div style={{ height: 5, borderRadius: 3, width: `${Math.max(barPct, 2)}%`, background: colour }} />
              </div>
              <span style={BAR_PCT}>{(o.probability * 100).toFixed(0)}%</span>
            </div>
          );
        })}
        {hiddenCount > 0 && (
          <span style={{ fontSize: 10, color: '#555', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>+{hiddenCount} more</span>
        )}
      </div>

      {/* 4. Footer */}
      <div style={FOOTER}>
        <CountdownTimer closesAt={closesAt} resolved={resolved} size="sm" />
        {betCount > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#555', fontFamily: 'JetBrains Mono, monospace' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(255,68,0,0.6)', display: 'inline-block' }} />
            {betCount}
          </span>
        )}
      </div>
    </div>
  );
}
