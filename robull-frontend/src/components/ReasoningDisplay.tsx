'use client';

import { useState } from 'react';

interface Section {
  header: string;
  bullets: string[];
}

const SECTION_HEADERS = ['STRENGTHS', 'RISKS', 'VERDICT'];

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
 * Parse reasoning text into sections based on STRENGTHS/RISKS/VERDICT headers.
 * Bullets are lines starting with • or - (after trimming).
 * Strips CHOSEN: and CRITICAL: lines.
 */
function parseSections(raw: string): Section[] | null {
  const text = stripMarkdown(raw);

  // Find each section header and its content
  const sections: Section[] = [];

  for (let i = 0; i < SECTION_HEADERS.length; i++) {
    const header = SECTION_HEADERS[i];
    const pattern = new RegExp(`(?:^|\\n)\\s*${header}\\s*[:—\\-]?\\s*`, 'i');
    const match = text.match(pattern);
    if (!match) continue;

    const start = match.index! + match[0].length;

    // Find end: next section header, CHOSEN: line, or end of text
    let end = text.length;
    for (let j = i + 1; j < SECTION_HEADERS.length; j++) {
      const nextPattern = new RegExp(`\\n\\s*${SECTION_HEADERS[j]}\\s*[:—\\-]`, 'i');
      const nextMatch = text.slice(start).match(nextPattern);
      if (nextMatch) {
        end = start + nextMatch.index!;
        break;
      }
    }

    // Also stop at CHOSEN: line
    const chosenMatch = text.slice(start, end).match(/\n\s*CHOSEN:/i);
    if (chosenMatch) {
      end = start + chosenMatch.index!;
    }

    const content = text.slice(start, end).trim();

    // Extract bullets: lines starting with • or -
    const bullets = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('•') || line.startsWith('-'))
      .map(line => line.replace(/^[•\-]\s*/, '').trim())
      .filter(line => line.length > 0);

    // If no bullet markers found, split on newlines as fallback
    if (bullets.length === 0 && content.length > 0) {
      const fallback = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.match(/^(CHOSEN|CRITICAL):/i));
      if (fallback.length > 0) {
        sections.push({ header, bullets: fallback });
        continue;
      }
    }

    if (bullets.length > 0) {
      sections.push({ header, bullets });
    }
  }

  return sections.length >= 2 ? sections : null;
}

function getVerdict(sections: Section[]): string[] {
  const verdict = sections.find(s => s.header === 'VERDICT');
  return verdict?.bullets ?? sections[sections.length - 1]?.bullets ?? [];
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
                    {s.bullets.map((b, i) => (
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

  // Unstructured reasoning — still parse • bullets if present
  const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const hasBullets = lines.some(l => l.startsWith('•') || l.startsWith('-'));

  if (hasBullets) {
    const bullets = lines
      .filter(l => !l.match(/^(CHOSEN|CRITICAL):/i))
      .map(l => l.replace(/^[•\-]\s*/, '').trim())
      .filter(l => l.length > 0);

    return (
      <div>
        {(!expanded ? bullets.slice(0, 3) : bullets).map((b, i) => (
          <p key={i} style={{ fontSize: 13, lineHeight: 1.5, color: '#ccc', display: 'flex', gap: 6 }}>
            <span style={{ color: '#555', flexShrink: 0 }}>&bull;</span>
            <span>{b}</span>
          </p>
        ))}
        {bullets.length > 3 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 font-mono text-[10px] text-accent hover:text-accent-dim"
          >
            {expanded ? 'COLLAPSE \u2191' : `+${bullets.length - 3} MORE`}
          </button>
        )}
      </div>
    );
  }

  // Plain text fallback
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
