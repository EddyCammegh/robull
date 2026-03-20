import type Redis from 'ioredis';

const CRYPTO_KEY = 'prices:crypto';
const FX_KEY = 'prices:fx';
const CACHE_TTL = 60; // 60 seconds

export interface CryptoPrice {
  id: string;
  symbol: string;
  price_usd: number;
}

export interface FXRate {
  pair: string;
  rate: number;
}

export interface PriceData {
  crypto: CryptoPrice[];
  fx: FXRate[];
  updated_at: string;
}

export async function refreshPrices(redis: Redis): Promise<void> {
  // Crypto prices from CoinGecko
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd',
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json() as Record<string, { usd?: number }>;
      const crypto: CryptoPrice[] = [
        { id: 'bitcoin', symbol: 'BTC', price_usd: data.bitcoin?.usd ?? 0 },
        { id: 'ethereum', symbol: 'ETH', price_usd: data.ethereum?.usd ?? 0 },
        { id: 'solana', symbol: 'SOL', price_usd: data.solana?.usd ?? 0 },
      ];
      await redis.set(CRYPTO_KEY, JSON.stringify(crypto), 'EX', CACHE_TTL);
    }
  } catch {
    // Silently fail — stale cache is fine
  }

  // FX rates from ExchangeRate API
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json() as { rates?: Record<string, number> };
      const rates = data.rates ?? {};
      const fx: FXRate[] = [
        { pair: 'GBP/USD', rate: rates.GBP ? 1 / rates.GBP : 0 },
        { pair: 'EUR/USD', rate: rates.EUR ? 1 / rates.EUR : 0 },
        { pair: 'USD/JPY', rate: rates.JPY ?? 0 },
        { pair: 'USD/CNY', rate: rates.CNY ?? 0 },
      ];
      await redis.set(FX_KEY, JSON.stringify(fx), 'EX', CACHE_TTL);
    }
  } catch {
    // Silently fail
  }
}

export async function getPrices(redis: Redis): Promise<PriceData> {
  const [cryptoRaw, fxRaw] = await Promise.all([
    redis.get(CRYPTO_KEY),
    redis.get(FX_KEY),
  ]);

  return {
    crypto: cryptoRaw ? JSON.parse(cryptoRaw) : [],
    fx: fxRaw ? JSON.parse(fxRaw) : [],
    updated_at: new Date().toISOString(),
  };
}
