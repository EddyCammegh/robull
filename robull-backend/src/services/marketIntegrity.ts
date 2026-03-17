import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { broadcastMarketClosed } from './sse.js';

// ─── Redis key conventions ─────────────────────────────────────────────────────
const MARKET_STATUS_KEY  = (id: string) => `market:status:${id}`;
const CIRCUIT_BREAKER    = 'platform:circuit_breaker';
const API_LAST_SUCCESS   = 'platform:api_last_success';
const MARKET_STATUS_TTL  = 60;       // seconds
const CIRCUIT_BREAKER_TTL = 600;     // auto-expire safety net (10 min)
const API_OUTAGE_THRESHOLD = 5 * 60; // 5 minutes in seconds
const CLOSE_BUFFER_MS = 30 * 60 * 1000; // 30 minutes

// ─── Market status cache ───────────────────────────────────────────────────────

export async function isMarketOpen(redis: Redis, db: Pool, marketId: string): Promise<boolean> {
  // Check Redis cache first
  const cached = await redis.get(MARKET_STATUS_KEY(marketId));
  if (cached === 'open') return true;
  if (cached === 'closed') return false;

  // Cache miss — fall back to DB
  const { rows } = await db.query(
    'SELECT resolved, closes_at FROM markets WHERE id = $1',
    [marketId]
  );
  if (!rows.length) return false;

  const { resolved, closes_at } = rows[0];

  // Check close buffer: reject if market closes within 30 minutes
  const closingSoon = closes_at && (new Date(closes_at).getTime() - Date.now()) <= CLOSE_BUFFER_MS;

  const open = !resolved && !closingSoon;
  await redis.set(MARKET_STATUS_KEY(marketId), open ? 'open' : 'closed', 'EX', MARKET_STATUS_TTL);
  return open;
}

export async function setMarketStatus(redis: Redis, marketId: string, status: 'open' | 'closed'): Promise<void> {
  await redis.set(MARKET_STATUS_KEY(marketId), status, 'EX', MARKET_STATUS_TTL);
}

// ─── Circuit breaker ───────────────────────────────────────────────────────────

export async function isPlatformPaused(redis: Redis): Promise<boolean> {
  const val = await redis.get(CIRCUIT_BREAKER);
  return val === 'paused';
}

export async function recordApiSuccess(redis: Redis): Promise<void> {
  await redis.set(API_LAST_SUCCESS, String(Math.floor(Date.now() / 1000)));
  await redis.del(CIRCUIT_BREAKER);
}

export async function recordApiFailure(redis: Redis): Promise<void> {
  const lastSuccess = await redis.get(API_LAST_SUCCESS);
  const lastSuccessTime = lastSuccess ? Number(lastSuccess) : 0;
  const now = Math.floor(Date.now() / 1000);

  if (now - lastSuccessTime >= API_OUTAGE_THRESHOLD) {
    await redis.set(CIRCUIT_BREAKER, 'paused', 'EX', CIRCUIT_BREAKER_TTL);
    console.error(`[circuit-breaker] Platform paused — Polymarket API unreachable for ${now - lastSuccessTime}s`);
  }
}

// ─── Close a market everywhere (DB + Redis + SSE) ──────────────────────────────

export async function closeMarketEverywhere(redis: Redis, db: Pool, marketId: string): Promise<void> {
  await db.query(
    'UPDATE markets SET resolved = true, updated_at = NOW() WHERE id = $1 AND resolved = false',
    [marketId]
  );
  await setMarketStatus(redis, marketId, 'closed');
  broadcastMarketClosed(marketId);
}

// ─── Close buffer: resolve markets within 30 min of closes_at ──────────────────

export async function enforceCloseBuffer(redis: Redis, db: Pool): Promise<number> {
  const { rows } = await db.query(
    `UPDATE markets SET resolved = true, updated_at = NOW()
     WHERE resolved = false
       AND closes_at IS NOT NULL
       AND closes_at <= NOW() + INTERVAL '30 minutes'
     RETURNING id`
  );

  for (const row of rows) {
    await setMarketStatus(redis, row.id, 'closed');
    broadcastMarketClosed(row.id);
  }

  return rows.length;
}
