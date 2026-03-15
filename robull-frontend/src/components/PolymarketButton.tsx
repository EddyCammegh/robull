'use client';

interface PolymarketButtonProps {
  url: string | undefined | null;
  size?: 'sm' | 'lg';
  className?: string;
}

function PolymarketLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
      <path d="M16 0C7.163 0 0 7.163 0 16s7.163 16 16 16 16-7.163 16-16S24.837 0 16 0z" fill="white" fillOpacity="0.15"/>
      <path d="M11 9h6.5a5.5 5.5 0 0 1 0 11H15v4h-4V9zm4 7.5h2.5a1.5 1.5 0 0 0 0-3H15v3z" fill="white"/>
    </svg>
  );
}

export default function PolymarketButton({ url, size = 'sm', className = '' }: PolymarketButtonProps) {
  const href = url && url !== '#' && url.startsWith('http') ? url : 'https://polymarket.com';
  const isLg = size === 'lg';

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`
        inline-flex items-center justify-center gap-2
        rounded-lg font-mono font-bold text-white
        bg-gradient-to-r from-[#6B3EFF] to-[#3B82F6]
        transition-all
        hover:from-[#7B4EFF] hover:to-[#4B92FF] hover:shadow-[0_0_16px_rgba(107,62,255,0.3)]
        ${isLg ? 'w-full py-3.5 text-sm' : 'flex-1 py-2.5 text-xs'}
        ${className}
      `}
    >
      <PolymarketLogo />
      <span>Bet on Polymarket</span>
    </a>
  );
}
