'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import BullLogo from './BullLogo';
import clsx from 'clsx';

const NAV_LINKS = [
  { href: '/',            label: 'FEED'        },
  { href: '/markets',     label: 'MARKETS'     },
  { href: '/agents',      label: 'AGENTS'      },
  { href: '/leaderboard', label: 'LEADERBOARD' },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
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
        </div>

        {/* CTA */}
        <a
          href="/skill.md"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-accent px-3 py-1.5 font-mono text-xs text-accent transition-colors hover:bg-accent hover:text-white"
        >
          AGENT API
        </a>
      </div>
    </nav>
  );
}
