'use client';

import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://robull-production.up.railway.app';

interface Article {
  title: string;
  url: string;
  source: string;
  published_at: string;
  summary: string;
  categories?: string[];
}

const CATEGORIES = ['ALL', 'POLITICS', 'MACRO', 'CRYPTO', 'AI/TECH'];

const SOURCE_CATEGORIES: Record<string, string[]> = {
  'BBC World':     ['POLITICS', 'MACRO'],
  'Guardian':      ['POLITICS', 'MACRO'],
  'Reuters':       ['POLITICS', 'MACRO'],
  'Politico':      ['POLITICS'],
  'AP News':       ['POLITICS', 'MACRO'],
  'Bloomberg':     ['MACRO'],
  'FT':            ['MACRO'],
  'Reuters Biz':   ['MACRO'],
  'CoinDesk':      ['CRYPTO'],
  'Decrypt':       ['CRYPTO'],
  'The Block':     ['CRYPTO'],
  'CoinTelegraph': ['CRYPTO'],
  'TechCrunch':    ['AI/TECH'],
  'The Verge':     ['AI/TECH'],
  'Ars Technica':  ['AI/TECH'],
};

const PAGE_SIZE = 12;

export default function NewsPanel() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [category, setCategory] = useState('');
  const [showCount, setShowCount] = useState(PAGE_SIZE);

  // Reset visible count when category changes
  useEffect(() => { setShowCount(PAGE_SIZE); }, [category]);

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const newsRes = await fetch(`${API}/v1/events`);
        if (!newsRes.ok) return;
        const events = await newsRes.json();
        if (!events.length) return;

        // Fetch from more events to build a diverse feed
        const allArticles: Article[] = [];
        const seen = new Set<string>();
        for (const evt of events.slice(0, 10)) {
          try {
            const nRes = await fetch(`${API}/v1/events/${evt.id}/news`);
            if (!nRes.ok) continue;
            const data = await nRes.json();
            for (const a of data.articles ?? []) {
              if (!seen.has(a.url)) {
                seen.add(a.url);
                allArticles.push({ ...a, categories: SOURCE_CATEGORIES[a.source] ?? [] });
              }
            }
          } catch { continue; }
        }

        allArticles.sort((a, b) => {
          try { return new Date(b.published_at).getTime() - new Date(a.published_at).getTime(); }
          catch { return 0; }
        });

        setArticles(allArticles);
      } catch {}
    };

    fetchNews();
    const interval = setInterval(fetchNews, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const filtered = category
    ? articles.filter((a) => (a.categories ?? []).includes(category))
    : articles;

  const visible = filtered.slice(0, showCount);
  const hasMore = filtered.length > showCount;

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-xs text-muted uppercase tracking-widest">News Feed</span>
          <span className="font-mono text-[10px] text-muted">{filtered.length} articles</span>
        </div>
        <div className="flex gap-1.5">
          {CATEGORIES.map((cat) => {
            const value = cat === 'ALL' ? '' : cat;
            const isActive = category === value;
            const count = value ? articles.filter(a => (a.categories ?? []).includes(value)).length : articles.length;
            return (
              <button
                key={cat}
                onClick={() => setCategory(value)}
                className={clsx(
                  'rounded px-2 py-1 font-mono text-[10px] transition-colors',
                  isActive
                    ? 'bg-accent text-white'
                    : 'border border-border text-muted hover:border-accent hover:text-accent'
                )}
              >
                {cat}
                {count > 0 && <span className="ml-1 opacity-50">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-h-[32rem] overflow-y-auto">
        {visible.length === 0 ? (
          <p className="p-4 font-mono text-xs text-muted text-center">
            {articles.length === 0 ? 'Loading news...' : 'No articles in this category'}
          </p>
        ) : (
          <>
            {visible.map((a, i) => (
              <a
                key={i}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 px-4 py-2.5 border-b border-border last:border-0 transition-colors hover:bg-subtle/30 group"
              >
                <span className="font-mono text-[9px] text-muted flex-shrink-0 w-16 pt-0.5 uppercase">
                  {a.source}
                </span>
                <span className="font-body text-xs text-gray-300 group-hover:text-white leading-snug flex-1 line-clamp-2">
                  {a.title}
                </span>
                <span className="font-mono text-[9px] text-muted flex-shrink-0 pt-0.5">
                  {(() => {
                    try { return formatDistanceToNow(new Date(a.published_at), { addSuffix: false }); }
                    catch { return ''; }
                  })()}
                </span>
              </a>
            ))}
            {hasMore && (
              <button
                onClick={() => setShowCount(prev => prev + PAGE_SIZE)}
                className="w-full py-2.5 font-mono text-[10px] text-accent hover:text-white transition-colors border-t border-border"
              >
                Show more ({filtered.length - showCount} remaining)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
