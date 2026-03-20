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

const CRYPTO_IDS = 'bitcoin,ethereum,solana,binancecoin,ripple,dogecoin,cardano,avalanche-2,polkadot,chainlink';
const CRYPTO_SYMBOLS: Record<string, string> = {
  bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', binancecoin: 'BNB',
  ripple: 'XRP', dogecoin: 'DOGE', cardano: 'ADA', 'avalanche-2': 'AVAX',
  polkadot: 'DOT', chainlink: 'LINK',
};

const FX_PAIRS: { pair: string; from: string; to: string; invert: boolean }[] = [
  { pair: 'GBP/USD', from: 'USD', to: 'GBP', invert: true },
  { pair: 'EUR/USD', from: 'USD', to: 'EUR', invert: true },
  { pair: 'USD/JPY', from: 'USD', to: 'JPY', invert: false },
  { pair: 'USD/CNY', from: 'USD', to: 'CNY', invert: false },
  { pair: 'USD/CHF', from: 'USD', to: 'CHF', invert: false },
  { pair: 'USD/CAD', from: 'USD', to: 'CAD', invert: false },
  { pair: 'AUD/USD', from: 'USD', to: 'AUD', invert: true },
  { pair: 'USD/KRW', from: 'USD', to: 'KRW', invert: false },
  { pair: 'USD/INR', from: 'USD', to: 'INR', invert: false },
  { pair: 'USD/BRL', from: 'USD', to: 'BRL', invert: false },
  { pair: 'USD/MXN', from: 'USD', to: 'MXN', invert: false },
  { pair: 'USD/SGD', from: 'USD', to: 'SGD', invert: false },
  { pair: 'USD/HKD', from: 'USD', to: 'HKD', invert: false },
  { pair: 'EUR/GBP', from: 'USD', to: 'EUR', invert: false }, // computed below
];

export async function refreshPrices(redis: Redis): Promise<void> {
  // Crypto prices from CoinGecko
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${CRYPTO_IDS}&vs_currencies=usd`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json() as Record<string, { usd?: number }>;
      const crypto: CryptoPrice[] = [];
      for (const [id, symbol] of Object.entries(CRYPTO_SYMBOLS)) {
        const price = data[id]?.usd;
        if (price) crypto.push({ id, symbol, price_usd: price });
      }
      if (crypto.length > 0) {
        await redis.set(CRYPTO_KEY, JSON.stringify(crypto), 'EX', CACHE_TTL);
      }
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
      const fx: FXRate[] = [];

      for (const p of FX_PAIRS) {
        if (p.pair === 'EUR/GBP') {
          // Compute cross rate
          const eurUsd = rates.EUR ? 1 / rates.EUR : 0;
          const gbpUsd = rates.GBP ? 1 / rates.GBP : 0;
          if (eurUsd > 0 && gbpUsd > 0) {
            fx.push({ pair: 'EUR/GBP', rate: eurUsd / gbpUsd });
          }
          continue;
        }
        const r = rates[p.to];
        if (r) {
          fx.push({ pair: p.pair, rate: p.invert ? 1 / r : r });
        }
      }

      if (fx.length > 0) {
        await redis.set(FX_KEY, JSON.stringify(fx), 'EX', CACHE_TTL);
      }
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
