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

export type MarketClosedReason = 'resolved' | 'ended' | 'closing_soon';

/**
 * Returns null if the market is open for betting, or a reason string if closed.
 */
export async function getMarketClosedReason(
  redis: Redis, db: Pool, marketId: string
): Promise<MarketClosedReason | null> {
  // Check Redis cache first
  const cached = await redis.get(MARKET_STATUS_KEY(marketId));
  if (cached === 'open') return null;
  // Cache stores 'closed' but not the reason — skip cache for closed markets
  // so we can return the specific reason from the DB.

  const { rows } = await db.query(
    'SELECT resolved, closes_at FROM markets WHERE id = $1',
    [marketId]
  );
  if (!rows.length) return 'resolved';

  const { resolved, closes_at } = rows[0];

  if (resolved) {
    await redis.set(MARKET_STATUS_KEY(marketId), 'closed', 'EX', MARKET_STATUS_TTL);
    return 'resolved';
  }

  if (closes_at) {
    const timeLeft = new Date(closes_at).getTime() - Date.now();
    if (timeLeft <= 0) {
      await redis.set(MARKET_STATUS_KEY(marketId), 'closed', 'EX', MARKET_STATUS_TTL);
      return 'ended';
    }
    if (timeLeft <= CLOSE_BUFFER_MS) {
      await redis.set(MARKET_STATUS_KEY(marketId), 'closed', 'EX', MARKET_STATUS_TTL);
      return 'closing_soon';
    }
  }

  await redis.set(MARKET_STATUS_KEY(marketId), 'open', 'EX', MARKET_STATUS_TTL);
  return null;
}

/** Convenience wrapper — preserves the old boolean API for callers that don't need the reason. */
export async function isMarketOpen(redis: Redis, db: Pool, marketId: string): Promise<boolean> {
  return (await getMarketClosedReason(redis, db, marketId)) === null;
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
  const now = Math.floor(Date.now() / 1000);

  // If no last success recorded, assume API was recently working (don't trip on cold start)
  if (!lastSuccess) {
    await redis.set(API_LAST_SUCCESS, String(now - 60));
    return;
  }

  const lastSuccessTime = Number(lastSuccess);
  if (now - lastSuccessTime >= API_OUTAGE_THRESHOLD) {
    await redis.set(CIRCUIT_BREAKER, 'paused', 'EX', CIRCUIT_BREAKER_TTL);
    console.error(`[circuit-breaker] Platform paused — Polymarket API unreachable for ${now - lastSuccessTime}s`);
  }
}

// ─── Close a market everywhere (DB + Redis + SSE) ──────────────────────────────

export async function closeMarketEverywhere(redis: Redis, db: Pool, marketId: string, winningOutcome?: number | null): Promise<void> {
  // Get event_id before closing, so we can check the parent event
  const { rows: [market] } = await db.query(
    'SELECT event_id FROM markets WHERE id = $1',
    [marketId]
  );

  if (winningOutcome != null) {
    await db.query(
      'UPDATE markets SET resolved = true, winning_outcome = $2, updated_at = NOW() WHERE id = $1 AND resolved = false',
      [marketId, winningOutcome]
    );
  } else {
    await db.query(
      'UPDATE markets SET resolved = true, updated_at = NOW() WHERE id = $1 AND resolved = false',
      [marketId]
    );
  }
  await setMarketStatus(redis, marketId, 'closed');
  broadcastMarketClosed(marketId);

  // Process payouts if we have a winning outcome (lazy import to avoid circular dep)
  if (winningOutcome != null) {
    const { processMarketPayouts } = await import('./payouts.js');
    await processMarketPayouts(db, marketId, winningOutcome);
  }

  // If this is a child market, check if the parent event should resolve
  if (market?.event_id) {
    await checkEventResolution(db, market.event_id);
  }
}

/**
 * Only resolve a parent event when ALL its child markets have resolved.
 * If any child is still active, keep the event open.
 */
export async function checkEventResolution(db: Pool, eventId: string): Promise<void> {
  const { rows: [counts] } = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(CASE WHEN resolved = false THEN 1 END)::int AS active
     FROM markets WHERE event_id = $1`,
    [eventId]
  );

  if (counts.total > 0 && counts.active === 0) {
    // All children resolved — resolve the parent event
    await db.query(
      'UPDATE events SET resolved = true, updated_at = NOW() WHERE id = $1 AND resolved = false',
      [eventId]
    );
    console.log(`[event] All ${counts.total} outcomes resolved — closing event ${eventId}`);
  } else {
    console.log(`[event] Keeping event ${eventId} open — ${counts.active} of ${counts.total} outcomes still active`);
  }
}

// ─── Close buffer: resolve markets within 30 min of closes_at ──────────────────

export async function enforceCloseBuffer(redis: Redis, db: Pool): Promise<number> {
  // Only close-buffer standalone markets. Child markets (event_id IS NOT NULL)
  // are managed by event lifecycle, not individual closes_at.
  const { rows } = await db.query(
    `UPDATE markets SET resolved = true, updated_at = NOW()
     WHERE resolved = false
       AND event_id IS NULL
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
