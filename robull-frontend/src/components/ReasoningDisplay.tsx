'use client';

import { useState } from 'react';

interface Section {
  header: string;
  content: string;
}

const SECTION_HEADERS = ['MARKET ASSESSMENT', 'MY EDGE', 'KEY RISKS', 'VERDICT'];

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

/**
 * Split content into bullet points by sentence boundaries.
 * Avoids splitting on decimals (0.5%, $1.2B) and abbreviations (U.S., Fed.).
 * Merges fragments under 20 chars back into the previous bullet.
 */
function toBullets(content: string): string[] {
  // Replace decimal numbers with placeholder to avoid splitting
  let safe = content.replace(/(\d)\.(\d)/g, '$1\x00$2');
  // Replace common abbreviations
  safe = safe.replace(/\b(U\.S|E\.U|Fed|Dr|Mr|Mrs|Inc|Ltd|Corp|etc|vs|Vol|Jr|Sr)\./gi, '$1\x01');

  // Split on ". " or "." at end
  const raw = safe.split(/\.\s+|\.$/);
  // Restore placeholders
  const parts = raw
    .map(s => s.replace(/\x00/g, '.').replace(/\x01/g, '.').trim())
    .filter(s => s.length > 0);

  // Merge short fragments (< 20 chars) back into previous
  const merged: string[] = [];
  for (const part of parts) {
    if (merged.length > 0 && part.length < 20) {
      merged[merged.length - 1] += '. ' + part;
    } else {
      merged.push(part);
    }
  }

  // Remove trailing period from each bullet
  return merged.map(s => s.replace(/\.$/, ''));
}

function parseSections(raw: string): Section[] | null {
  const text = stripMarkdown(raw);
  const sections: Section[] = [];

  for (let i = 0; i < SECTION_HEADERS.length; i++) {
    const header = SECTION_HEADERS[i];
    const pattern = new RegExp(`(?:^|\\n)\\s*${header.replace(/\s+/g, '\\s*')}\\s*[:—\\-]\\s*`, 'i');
    const match = text.match(pattern);
    if (!match) return null;

    const start = match.index! + match[0].length;
    let end = text.length;
    for (let j = i + 1; j < SECTION_HEADERS.length; j++) {
      const nextPattern = new RegExp(`\\n\\s*${SECTION_HEADERS[j].replace(/\s+/g, '\\s*')}\\s*[:—\\-]`, 'i');
      const nextMatch = text.slice(start).match(nextPattern);
      if (nextMatch) {
        end = start + nextMatch.index!;
        break;
      }
    }

    sections.push({ header, content: text.slice(start, end).trim() });
  }

  return sections.length >= 3 ? sections : null;
}

function getVerdict(sections: Section[]): string[] {
  const verdict = sections.find(s => s.header === 'VERDICT');
  return toBullets(verdict?.content ?? sections[sections.length - 1]?.content ?? '');
}

interface ReasoningDisplayProps {
  reasoning: string;
  defaultExpanded?: boolean;
}

export default function ReasoningDisplay({ reasoning, defaultExpanded = false }: ReasoningDisplayProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const sections = parseSections(reasoning);
  const cleanText = stripMarkdown(reasoning);

  if (sections) {
    const verdictBullets = getVerdict(sections);

    return (
      <div>
        {!expanded ? (
          <div>
            {verdictBullets.map((b, i) => (
              <p key={i} style={{ fontSize: 13, lineHeight: 1.5, color: '#fff', fontWeight: 600 }}>
                {verdictBullets.length > 1 && <span style={{ color: '#FF4400', marginRight: 6 }}>&bull;</span>}
                {b}
              </p>
            ))}
            <button
              onClick={() => setExpanded(true)}
              className="mt-1.5 font-mono text-[10px] text-accent hover:text-accent-dim"
            >
              VIEW FULL ANALYSIS &darr;
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sections.map((s) => {
              const bullets = toBullets(s.content);
              const isVerdict = s.header === 'VERDICT';
              return (
                <div key={s.header}>
                  <p style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: '#FF4400',
                    fontFamily: 'JetBrains Mono, monospace',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 4,
                  }}>
                    {s.header}
                  </p>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {bullets.map((b, i) => (
                      <li key={i} style={{
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: isVerdict ? '#fff' : '#ccc',
                        fontWeight: isVerdict ? 600 : 400,
                        display: 'flex',
                        gap: 6,
                      }}>
                        <span style={{ color: '#555', flexShrink: 0 }}>&bull;</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <button
              onClick={() => setExpanded(false)}
              className="font-mono text-[10px] text-muted hover:text-accent"
            >
              COLLAPSE &uarr;
            </button>
          </div>
        )}
      </div>
    );
  }

  // Unstructured reasoning
  const LIMIT = 200;
  const isLong = cleanText.length > LIMIT;

  return (
    <div>
      <p className="font-body text-sm leading-relaxed text-gray-300">
        {isLong && !expanded ? `${cleanText.slice(0, LIMIT)}...` : cleanText}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 font-mono text-[10px] text-accent hover:text-accent-dim"
        >
          {expanded ? 'COLLAPSE \u2191' : 'READ MORE'}
        </button>
      )}
    </div>
  );
}
