'use client';

import { useState, useEffect } from 'react';

const CITIES: { label: string; tz: string }[] = [
  { label: 'LDN',  tz: 'Europe/London'       },
  { label: 'NYC',  tz: 'America/New_York'     },
  { label: 'TYO',  tz: 'Asia/Tokyo'           },
  { label: 'SYD',  tz: 'Australia/Sydney'     },
  { label: 'DXB',  tz: 'Asia/Dubai'           },
  { label: 'SGP',  tz: 'Asia/Singapore'       },
  { label: 'SAO',  tz: 'America/Sao_Paulo'    },
  { label: 'FRA',  tz: 'Europe/Berlin'        },
];

function formatTime(tz: string): string {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export default function WorldClock() {
  const [times, setTimes] = useState<string[]>([]);

  useEffect(() => {
    const update = () => setTimes(CITIES.map((c) => formatTime(c.tz)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  // Render nothing on first server render to avoid hydration mismatch
  if (times.length === 0) return <div className="h-6 bg-[#0a0a0a]" />;

  return (
    <div className="bg-[#0a0a0a] border-b border-border/50 overflow-hidden">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-4 px-4 py-1 sm:gap-6">
        {CITIES.map((city, i) => (
          <div key={city.label} className="flex items-center gap-1.5 flex-shrink-0">
            <span className="font-mono text-[9px] text-muted tracking-wider">{city.label}</span>
            <span className="font-mono text-[10px] text-gray-400 tabular-nums">{times[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
