import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { fetchMarketStatus } from '../services/polymarket.js';
import {
  closeMarketEverywhere,
  setMarketStatus,
  recordApiSuccess,
  recordApiFailure,
  enforceCloseBuffer,
} from '../services/marketIntegrity.js';

type Tier = 'urgent' | 'soon' | 'distant';

const TIER_FILTERS: Record<Tier, string> = {
  urgent:  `(closes_at IS NULL OR closes_at <= NOW() + INTERVAL '24 hours')`,
  soon:    `(closes_at > NOW() + INTERVAL '24 hours' AND closes_at <= NOW() + INTERVAL '7 days')`,
  distant: `(closes_at > NOW() + INTERVAL '7 days')`,
};

// Process markets in batches to avoid overwhelming the Polymarket API
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncTier(db: Pool, redis: Redis, tier: Tier): Promise<void> {
  // Enforce close buffer (10 min before closes_at) before checking tier
  const buffered = await enforceCloseBuffer(redis, db);
  if (buffered > 0) {
    console.log(`[integrity:${tier}] Close buffer resolved ${buffered} markets.`);
  }

  // Only check standalone markets — child markets are managed by event lifecycle
  const { rows: markets } = await db.query(
    `SELECT id, polymarket_id, closes_at FROM markets
     WHERE resolved = false AND event_id IS NULL AND ${TIER_FILTERS[tier]}`
  );

  if (markets.length === 0) return;

  let closed = 0;
  let refreshed = 0;
  let apiOk = false;

  for (let i = 0; i < markets.length; i += BATCH_SIZE) {
    const batch = markets.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (market) => {
      const status = await fetchMarketStatus(market.polymarket_id);

      if (status === null) {
        // API call failed for this market — don't update, let circuit breaker track
        return;
      }

      apiOk = true; // at least one API call succeeded

      if (!status.active || status.closed) {
        if (status.winningOutcome != null) {
          console.log(`[integrity:${tier}] Closing market ${market.polymarket_id} with winning_outcome=${status.winningOutcome}`);
        }
        await closeMarketEverywhere(redis, db, market.id, status.winningOutcome);
        closed++;
      } else {
        await setMarketStatus(redis, market.id, 'open');
        refreshed++;
      }
    }));

    // Small delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < markets.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  // Update circuit breaker state
  if (apiOk) {
    await recordApiSuccess(redis);
  } else if (markets.length > 0) {
    await recordApiFailure(redis);
  }

  if (closed > 0 || refreshed > 0) {
    console.log(`[integrity:${tier}] ${markets.length} markets checked — ${closed} closed, ${refreshed} refreshed.`);
  }
}
