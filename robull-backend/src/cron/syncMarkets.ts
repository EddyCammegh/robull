import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { fetchPolymarkets, classifyCategory, isLowQualityMarket } from '../services/polymarket.js';
import { recordApiSuccess, recordApiFailure, enforceCloseBuffer } from '../services/marketIntegrity.js';

async function logCategoryCounts(db: Pool, label: string): Promise<void> {
  const { rows } = await db.query(
    `SELECT category, COUNT(*)::int AS count
     FROM markets WHERE resolved = false
     GROUP BY category ORDER BY count DESC`
  );
  const total = rows.reduce((s, r) => s + r.count, 0);
  const summary = rows.map(r => `${r.category}=${r.count}`).join(' ');
  console.log(`[cron] ${label}: ${summary} TOTAL=${total}`);
}

export async function syncMarkets(db: Pool, redis: Redis): Promise<void> {
  console.log('[cron] Syncing markets from Polymarket...');
  let synced = 0;

  try {
    await logCategoryCounts(db, 'Before sync');

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

    // ── Cleanup: resolve existing markets that fail the new filters ──────────
    const MIN_VOL_DEFAULT = 500_000;
    const MIN_VOL_CRYPTO_MACRO = 50_000;
    const { rows: allMarkets } = await db.query(
      `SELECT id, question, category, volume, initial_probs FROM markets WHERE resolved = false`
    );
    let cleaned = 0;
    for (const row of allMarkets) {
      const vol = typeof row.volume === 'string' ? parseFloat(row.volume) : row.volume;
      const probs: number[] = Array.isArray(row.initial_probs) ? row.initial_probs : [];
      const cat = row.category as string;
      const minVol = (cat === 'CRYPTO' || cat === 'MACRO') ? MIN_VOL_CRYPTO_MACRO : MIN_VOL_DEFAULT;
      if (vol < minVol || isLowQualityMarket(row.question, probs)) {
        await db.query('UPDATE markets SET resolved = true, updated_at = NOW() WHERE id = $1', [row.id]);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[cron] Cleanup: resolved ${cleaned} markets that fail new quality filters.`);
    }

    // Enforce close buffer — resolve markets within 10 min of closes_at
    const buffered = await enforceCloseBuffer(redis, db);
    if (buffered > 0) {
      console.log(`[cron] Close buffer resolved ${buffered} markets.`);
    }

    await logCategoryCounts(db, 'After sync');
  } catch (err) {
    // API fetch failed — record failure for circuit breaker
    await recordApiFailure(redis).catch(() => {});
    console.error('[cron] Market sync failed:', err);
  }
}
