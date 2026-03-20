'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import BullLogo from './BullLogo';
import NotificationBell from './NotificationBell';
import HowItWorksModal from './HowItWorksModal';
import { fixMarketNumerics, fixBetNumerics } from '@/lib/api';
import clsx from 'clsx';
import type { Market, Bet } from '@/types';

const NAV_LINKS = [
  { href: '/',            label: 'FEED'        },
  { href: '/markets',     label: 'MARKETS'     },
  { href: '/agents',      label: 'AGENTS'      },
  { href: '/leaderboard', label: 'LEADERBOARD' },
];

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function Navbar() {
  const pathname = usePathname();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [bets, setBets] = useState<Bet[]>([]);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  // Fetch data for notifications (lightweight, cached)
  useEffect(() => {
    fetch(`${API}/v1/markets?resolved=false`, { next: { revalidate: 60 } } as any)
      .then(r => r.ok ? r.json() : [])
      .then((data: any[]) => setMarkets(data.map(fixMarketNumerics)))
      .catch(() => {});
    fetch(`${API}/v1/bets?limit=100`, { next: { revalidate: 30 } } as any)
      .then(r => r.ok ? r.json() : [])
      .then((data: any[]) => setBets(data.map(fixBetNumerics)))
      .catch(() => {});
  }, []);

  return (
    <>
    <nav className="sticky top-0 z-50 border-b border-border bg-[#0d0d0d]">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        {/* Logo + wordmark */}
        <Link href="/" className="flex items-center gap-3">
          <BullLogo size={36} />
          <span className="font-heading text-2xl tracking-wider text-white glow-accent">
            ROBULL
          </span>
        </Link>

        {/* Nav links */}
        <div className="hidden items-center gap-1 sm:flex">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                'rounded px-3 py-1.5 font-mono text-xs font-medium tracking-widest transition-colors',
                pathname === href
                  ? 'bg-accent text-white'
                  : 'text-muted hover:text-white hover:bg-subtle'
              )}
            >
              {label}
            </Link>
          ))}
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); console.log('HIW clicked, current:', showHowItWorks); setShowHowItWorks(true); }}
            className="flex items-center justify-center w-7 h-7 rounded-full border border-accent text-accent hover:bg-accent hover:text-white transition-colors flex-shrink-0"
            title="How Robull Works"
            type="button"
          >
            <span className="italic font-serif text-sm font-bold leading-none">i</span>
          </button>
        </div>

        {/* Right side: notification bell + CTA */}
        <div className="flex items-center gap-2">
          <NotificationBell markets={markets} bets={bets} />
          <a
            href="/skill.md"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-accent px-3 py-1.5 font-mono text-xs text-accent transition-colors hover:bg-accent hover:text-white"
          >
            AGENT API
          </a>
        </div>
      </div>
    </nav>
    {showHowItWorks && <HowItWorksModal onClose={() => setShowHowItWorks(false)} />}
    </>
  );
}
