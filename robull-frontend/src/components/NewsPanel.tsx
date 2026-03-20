'use client';

import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Article {
  title: string;
  url: string;
  source: string;
  published_at: string;
  summary: string;
  categories?: string[];
}

const CATEGORIES = ['ALL', 'POLITICS', 'MACRO', 'CRYPTO', 'AI/TECH'];

// Map source names to categories for filtering
const SOURCE_CATEGORIES: Record<string, string[]> = {
  'BBC World': ['POLITICS', 'MACRO'],
  'Guardian': ['POLITICS', 'MACRO'],
  'CoinDesk': ['CRYPTO'],
  'Decrypt': ['CRYPTO'],
  'TechCrunch': ['AI/TECH'],
  'The Verge': ['AI/TECH'],
};

export default function NewsPanel() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [category, setCategory] = useState('');

  useEffect(() => {
    const fetchNews = async () => {
      try {
        // Fetch news for a generic event to get all cached articles
        const res = await fetch(`${API}/v1/prices`);
        // Also try a general news fetch — use a known event or fallback
        const newsRes = await fetch(`${API}/v1/events`);
        if (!newsRes.ok) return;
        const events = await newsRes.json();
        if (!events.length) return;

        // Fetch news from first few events to build a diverse feed
        const allArticles: Article[] = [];
        const seen = new Set<string>();
        for (const evt of events.slice(0, 5)) {
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

        // Sort by published_at descending
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
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="p-4 font-mono text-xs text-muted text-center">Loading news...</p>
        ) : (
          filtered.map((a, i) => (
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
          ))
        )}
      </div>
    </div>
  );
}
