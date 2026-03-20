'use client';

import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { api } from '@/lib/api';

interface Article {
  title: string;
  url: string;
  source: string;
  published_at: string;
}

export default function EventNews({ eventId }: { eventId: string }) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded) return;
    setLoaded(true);
    api.news.forEvent(eventId).then((data) => {
      setArticles(data.articles?.slice(0, 5) ?? []);
    }).catch(() => {});
  }, [eventId, loaded]);

  if (articles.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono text-[10px] text-muted uppercase tracking-widest">Latest News</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      <div className="space-y-1">
        {articles.map((a, i) => (
          <a
            key={i}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 rounded px-2 py-1.5 transition-colors hover:bg-subtle/40 group"
          >
            <span className="font-mono text-[9px] text-muted flex-shrink-0 w-16 pt-0.5">
              {a.source}
            </span>
            <span className="font-body text-xs text-gray-300 group-hover:text-white leading-snug line-clamp-1 flex-1">
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
      </div>
    </div>
  );
}
