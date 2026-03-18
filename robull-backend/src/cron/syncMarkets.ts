import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { fetchPolymarkets, classifyCategory, isLowQualityMarket, fetchRecentlySettledMarkets, fetchMarketStatus, fetchPolymarketEvents } from '../services/polymarket.js';
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

    let inserted = 0;
    const fetchedIds = new Set<string>();
    for (const m of markets) {
      fetchedIds.add(m.polymarket_id);
      const { rows: upserted } = await db.query(
        `INSERT INTO markets
           (polymarket_id, question, category, slug, polymarket_url, volume,
            b_parameter, outcomes, quantities, initial_probs, closes_at, resolved, event_title)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, true, $12)
         ON CONFLICT (polymarket_id) DO UPDATE SET
           volume         = EXCLUDED.volume,
           category       = EXCLUDED.category,
           slug           = EXCLUDED.slug,
           polymarket_url = EXCLUDED.polymarket_url,
           closes_at      = EXCLUDED.closes_at,
           event_title    = COALESCE(EXCLUDED.event_title, markets.event_title),
           updated_at     = NOW()
         -- Do NOT overwrite quantities or resolved — managed by backfill
         RETURNING (xmax = 0) AS is_new
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
          m.event_title,
        ]
      );
      synced++;
      if (upserted[0]?.is_new) inserted++;
    }

    console.log(`[cron] Synced ${synced} markets from API (${inserted} new, ${synced - inserted} updated).`);

    // ── Sync multi-outcome events ─────────────────────────────────────────
    const events = await fetchPolymarketEvents();
    let eventsSynced = 0;
    let childrenSynced = 0;
    for (const evt of events) {
      // Upsert event row
      const { rows: [evtRow] } = await db.query(
        `INSERT INTO events
           (polymarket_event_id, title, slug, category, polymarket_url, volume, closes_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (polymarket_event_id) DO UPDATE SET
           title          = EXCLUDED.title,
           volume         = EXCLUDED.volume,
           category       = EXCLUDED.category,
           closes_at      = EXCLUDED.closes_at,
           updated_at     = NOW()
         RETURNING id`,
        [evt.polymarket_event_id, evt.title, evt.slug, evt.category, evt.polymarket_url, evt.volume, evt.closes_at]
      );
      const eventId = evtRow.id;

      // Upsert child markets linked to this event
      for (const child of evt.child_markets) {
        fetchedIds.add(child.polymarket_id);
        await db.query(
          `INSERT INTO markets
             (polymarket_id, question, category, slug, polymarket_url, volume,
              b_parameter, outcomes, quantities, initial_probs, closes_at, resolved,
              event_id, outcome_label)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, false, $12, $13)
           ON CONFLICT (polymarket_id) DO UPDATE SET
             volume         = EXCLUDED.volume,
             category       = EXCLUDED.category,
             closes_at      = EXCLUDED.closes_at,
             event_id       = EXCLUDED.event_id,
             outcome_label  = EXCLUDED.outcome_label,
             resolved       = false,
             updated_at     = NOW()
           `,
          [
            child.polymarket_id, child.question, evt.category, evt.slug,
            evt.polymarket_url, child.volume, child.b_parameter,
            child.outcomes, child.quantities, child.initial_probs,
            child.closes_at, eventId, child.outcome_label,
          ]
        );
        childrenSynced++;
      }
      eventsSynced++;
    }
    console.log(`[cron] Synced ${eventsSynced} events with ${childrenSynced} child markets.`);

    // Verify: count markets with/without event_id
    const { rows: [eidCounts] } = await db.query(
      `SELECT COUNT(event_id)::int AS with_eid, (COUNT(*) - COUNT(event_id))::int AS without_eid FROM markets`
    );
    console.log(`[cron] Markets: ${eidCounts.with_eid} with event_id, ${eidCounts.without_eid} standalone.`);

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

    // ── Backfill winning outcomes ──────────────────────────────────────────
    // Two-pronged approach:
    //   A) Bulk: fetch 100 recently settled markets FROM Polymarket, match to our DB
    //   B) Per-market: check our own resolved markets individually (catches ones
    //      not in the top 100 settled list)

    let totalFilled = 0;

    // --- A) Bulk match from Polymarket's recently settled ---
    const settled = await fetchRecentlySettledMarkets();
    if (settled.length > 0) {
      const settledMap = new Map(settled.map(s => [s.polymarketId, s.winningOutcome]));
      const polyIds = settled.map(s => s.polymarketId);
      const { rows: dbMatches } = await db.query(
        `SELECT id, polymarket_id, question FROM markets
         WHERE polymarket_id = ANY($1) AND winning_outcome IS NULL`,
        [polyIds]
      );
      for (const m of dbMatches) {
        const winner = settledMap.get(m.polymarket_id);
        if (winner != null) {
          await db.query(
            'UPDATE markets SET winning_outcome = $2, resolved = true, updated_at = NOW() WHERE id = $1',
            [m.id, winner]
          );
          console.log(`[backfill:bulk] winning_outcome=${winner} for "${m.question?.slice(0, 60)}"`);
          totalFilled++;
        }
      }
      console.log(`[cron] Backfill bulk: ${settled.length} settled on Polymarket, ${dbMatches.length} matched our DB.`);
    }

    // --- B) Per-market check for our resolved markets still missing outcome ---
    const { rows: missingOutcome } = await db.query(
      `SELECT id, polymarket_id, question FROM markets
       WHERE resolved = true AND winning_outcome IS NULL
       ORDER BY updated_at DESC LIMIT 20`
    );
    if (missingOutcome.length > 0) {
      for (const m of missingOutcome) {
        const status = await fetchMarketStatus(m.polymarket_id);
        if (status?.winningOutcome != null) {
          await db.query(
            'UPDATE markets SET winning_outcome = $2, updated_at = NOW() WHERE id = $1',
            [m.id, status.winningOutcome]
          );
          console.log(`[backfill:per-market] winning_outcome=${status.winningOutcome} for "${m.question?.slice(0, 60)}"`);
          totalFilled++;
        }
      }
      console.log(`[cron] Backfill per-market: checked ${missingOutcome.length}, still awaiting Polymarket settlement.`);
    }

    if (totalFilled > 0) {
      console.log(`[cron] Backfill total: ${totalFilled} winning outcomes set.`);
    }

    // ── Backfill / trim: maintain exactly 150 active slots ───────────────
    // Events count as 1 slot regardless of child markets. Standalone markets = 1 slot.
    const TARGET_ACTIVE = 150;
    const { rows: [{ standalone }] } = await db.query(
      `SELECT COUNT(*)::int AS standalone FROM markets WHERE resolved = false AND event_id IS NULL`
    );
    const { rows: [{ event_count }] } = await db.query(
      `SELECT COUNT(DISTINCT event_id)::int AS event_count FROM markets WHERE resolved = false AND event_id IS NOT NULL`
    );
    const activeCount = (standalone as number) + (event_count as number);

    if (activeCount < TARGET_ACTIVE) {
      const slots = TARGET_ACTIVE - activeCount;
      // Best candidates: resolved, still in current API fetch (confirmed active
      // on Polymarket), ordered by volume so highest-signal markets fill first.
      const { rows: candidates } = await db.query(
        `SELECT id, polymarket_id FROM markets
         WHERE resolved = true AND event_id IS NULL
         ORDER BY volume DESC`
      );
      let activated = 0;
      for (const c of candidates) {
        if (activated >= slots) break;
        if (!fetchedIds.has(c.polymarket_id)) continue;
        await db.query(
          'UPDATE markets SET resolved = false, updated_at = NOW() WHERE id = $1',
          [c.id]
        );
        activated++;
      }
      if (activated > 0) {
        console.log(`[cron] Backfill: activated ${activated} markets (${activeCount} → ${activeCount + activated}).`);
      }
    } else if (activeCount > TARGET_ACTIVE) {
      const excess = activeCount - TARGET_ACTIVE;
      await db.query(
        `UPDATE markets SET resolved = true, updated_at = NOW()
         WHERE id IN (
           SELECT id FROM markets
           WHERE resolved = false AND event_id IS NULL
           ORDER BY volume ASC
           LIMIT $1
         )`,
        [excess]
      );
      console.log(`[cron] Trimmed ${excess} lowest-volume standalone markets (${activeCount} → ${TARGET_ACTIVE}).`);
    }

    await logCategoryCounts(db, 'After sync');
  } catch (err) {
    // API fetch failed — record failure for circuit breaker
    await recordApiFailure(redis).catch(() => {});
    console.error('[cron] Market sync failed:', err);
  }
}
