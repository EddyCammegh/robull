import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { fetchPolymarkets, classifyCategory } from '../services/polymarket.js';
import { recordApiSuccess, recordApiFailure, enforceCloseBuffer } from '../services/marketIntegrity.js';

export async function syncMarkets(db: Pool, redis: Redis): Promise<void> {
  console.log('[cron] Syncing markets from Polymarket...');
  let synced = 0;

  try {
    const markets = await fetchPolymarkets();

    // API fetch succeeded — clear circuit breaker
    await recordApiSuccess(redis);

    for (const m of markets) {
      await db.query(
        `INSERT INTO markets
           (polymarket_id, question, category, slug, polymarket_url, volume,
            b_parameter, outcomes, quantities, initial_probs, closes_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (polymarket_id) DO UPDATE SET
           volume         = EXCLUDED.volume,
           category       = EXCLUDED.category,
           slug           = EXCLUDED.slug,
           polymarket_url = EXCLUDED.polymarket_url,
           closes_at      = EXCLUDED.closes_at,
           updated_at     = NOW()
         -- Do NOT overwrite quantities — they track live LMSR state
         `,
        [
          m.polymarket_id,
          m.question,
          m.category,
          m.slug,
          m.polymarket_url,
          m.volume,
          m.b_parameter,
          m.outcomes,
          m.quantities,
          m.initial_probs,
          m.closes_at,
        ]
      );
      synced++;
    }

    console.log(`[cron] Synced ${synced} markets from API.`);

    // Reclassify ALL markets in DB using the latest classification rules
    const { rows } = await db.query('SELECT id, question, category FROM markets');
    let reclassified = 0;
    for (const row of rows) {
      const newCategory = classifyCategory(row.question);
      if (newCategory !== row.category) {
        await db.query('UPDATE markets SET category = $1, updated_at = NOW() WHERE id = $2', [newCategory, row.id]);
        reclassified++;
      }
    }
    if (reclassified > 0) {
      console.log(`[cron] Reclassified ${reclassified} markets.`);
    }

    // Enforce close buffer — resolve markets within 10 min of closes_at
    const buffered = await enforceCloseBuffer(redis, db);
    if (buffered > 0) {
      console.log(`[cron] Close buffer resolved ${buffered} markets.`);
    }
  } catch (err) {
    // API fetch failed — record failure for circuit breaker
    await recordApiFailure(redis).catch(() => {});
    console.error('[cron] Market sync failed:', err);
  }
}
