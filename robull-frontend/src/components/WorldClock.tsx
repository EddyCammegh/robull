'use client';

import { useState, useEffect } from 'react';

const CITIES: { flag: string; label: string; tz: string }[] = [
  { flag: '🇬🇧', label: 'London',       tz: 'Europe/London'        },
  { flag: '🇺🇸', label: 'New York',      tz: 'America/New_York'     },
  { flag: '🇯🇵', label: 'Tokyo',         tz: 'Asia/Tokyo'           },
  { flag: '🇦🇺', label: 'Sydney',        tz: 'Australia/Sydney'     },
  { flag: '🇦🇪', label: 'Dubai',         tz: 'Asia/Dubai'           },
  { flag: '🇸🇬', label: 'Singapore',     tz: 'Asia/Singapore'       },
  { flag: '🇧🇷', label: 'São Paulo',     tz: 'America/Sao_Paulo'    },
  { flag: '🇩🇪', label: 'Frankfurt',     tz: 'Europe/Berlin'        },
  { flag: '🇭🇰', label: 'Hong Kong',     tz: 'Asia/Hong_Kong'       },
  { flag: '🇮🇳', label: 'Mumbai',        tz: 'Asia/Kolkata'         },
  { flag: '🇪🇬', label: 'Cairo',         tz: 'Africa/Cairo'         },
  { flag: '🇿🇦', label: 'Johannesburg',  tz: 'Africa/Johannesburg'  },
  { flag: '🇷🇺', label: 'Moscow',        tz: 'Europe/Moscow'        },
  { flag: '🇫🇷', label: 'Paris',         tz: 'Europe/Paris'         },
  { flag: '🇨🇦', label: 'Toronto',       tz: 'America/Toronto'      },
  { flag: '🇺🇸', label: 'Chicago',       tz: 'America/Chicago'      },
  { flag: '🇺🇸', label: 'Los Angeles',   tz: 'America/Los_Angeles'  },
  { flag: '🇰🇷', label: 'Seoul',         tz: 'Asia/Seoul'           },
  { flag: '🇮🇩', label: 'Jakarta',       tz: 'Asia/Jakarta'         },
  { flag: '🇸🇦', label: 'Riyadh',        tz: 'Asia/Riyadh'          },
  { flag: '🇹🇷', label: 'Istanbul',      tz: 'Europe/Istanbul'      },
  { flag: '🇲🇽', label: 'Mexico City',   tz: 'America/Mexico_City'  },
  { flag: '🇦🇷', label: 'Buenos Aires',  tz: 'America/Argentina/Buenos_Aires' },
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

  if (times.length === 0) return <div className="h-6 bg-[#0a0a0a]" />;

  // Render the city list twice for seamless infinite scroll
  const items = CITIES.map((city, i) => (
    <span key={city.label} className="inline-flex items-center gap-1.5 px-3 flex-shrink-0">
      <span className="text-[10px]">{city.flag}</span>
      <span className="font-mono text-[9px] text-muted tracking-wider whitespace-nowrap">{city.label}</span>
      <span className="font-mono text-[10px] text-gray-400 tabular-nums">{times[i]}</span>
    </span>
  ));

  return (
    <div className="bg-[#0a0a0a] border-b border-border/50 overflow-hidden">
      <div className="ticker-track flex items-center py-1">
        <div className="ticker-content flex items-center">{items}</div>
        <div className="ticker-content flex items-center" aria-hidden>{items}</div>
      </div>
    </div>
  );
}
