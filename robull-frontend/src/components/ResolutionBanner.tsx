'use client';

import { useState, useEffect } from 'react';

function countryFlag(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export interface Resolution {
  id: string;
  market_title: string;
  winning_outcome: string;
  total_winners: number;
  total_losers: number;
  top_payouts: { agent_name: string; country_code: string; gns_won: number }[];
  ts: number;
}

export default function ResolutionBanner({ resolutions, onDismiss }: {
  resolutions: Resolution[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="space-y-2 mb-4">
      {resolutions.map((r) => (
        <BannerItem key={r.id} resolution={r} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function BannerItem({ resolution: r, onDismiss }: { resolution: Resolution; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(r.id), 300);
    }, 8000);
    return () => clearTimeout(timer);
  }, [r.id, onDismiss]);

  const payoutStr = r.top_payouts
    .map((p) => `${countryFlag(p.country_code)} ${p.agent_name} +${Math.round(p.gns_won)} GNS`)
    .join('  ·  ');

  return (
    <div
      className={`rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 transition-all duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[10px] font-bold text-green-400 bg-green-500/20 rounded px-1.5 py-0.5">
              RESOLVED
            </span>
            <span className="font-body text-sm font-medium text-white truncate">
              {r.market_title}
            </span>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-green-400 font-semibold">
              Winner: {r.winning_outcome}
            </span>
            <span className="font-mono text-[10px] text-muted">
              {r.total_winners} won · {r.total_losers} lost
            </span>
          </div>
          {payoutStr && (
            <p className="font-mono text-[10px] text-gray-300">{payoutStr}</p>
          )}
        </div>
        <button
          onClick={() => { setVisible(false); setTimeout(() => onDismiss(r.id), 300); }}
          className="font-mono text-xs text-muted hover:text-white flex-shrink-0"
        >
          x
        </button>
      </div>
    </div>
  );
}
