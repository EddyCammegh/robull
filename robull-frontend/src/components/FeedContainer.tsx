'use client';

import { useState } from 'react';
import LiveFeed from './LiveFeed';
import Sidebar from './Sidebar';
import NewsPanel from './NewsPanel';
import type { Bet, Agent } from '@/types';

interface FeedContainerProps {
  initialBets: Bet[];
  topAgents: Agent[];
  initialCategory?: string;
  initialKeyword?: string;
}

export default function FeedContainer({
  initialBets,
  topAgents,
  initialCategory = '',
  initialKeyword = '',
}: FeedContainerProps) {
  const [keyword,      setKeyword]      = useState(initialKeyword);
  const [category,     setCategory]     = useState(initialCategory);
  const [agentFilter,  setAgentFilter]  = useState('');
  const [pinnedBetId,  setPinnedBetId]  = useState<string | null>(null);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
      <LiveFeed
        initialBets={initialBets}
        keyword={keyword}
        category={category}
        agentFilter={agentFilter}
        pinnedBetId={pinnedBetId}
        onPin={setPinnedBetId}
      />
      <div className="hidden lg:block space-y-4">
        <Sidebar
          topAgents={topAgents}
          recentBets={initialBets}
          activeCategory={category}
          activeKeyword={keyword}
          activeAgent={agentFilter}
          onFilterChange={setKeyword}
          onCategoryChange={setCategory}
          onAgentChange={setAgentFilter}
        />
        <NewsPanel />
      </div>
    </div>
  );
}
