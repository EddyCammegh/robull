import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { fetchPolymarkets, classifyCategory, isLowQualityMarket, isExcludedCategory, isF1Market, fetchRecentlySettledMarkets, fetchMarketStatus, fetchPolymarketEvents } from '../services/polymarket.js';
import { recordApiSuccess, recordApiFailure, enforceCloseBuffer, checkEventResolution } from '../services/marketIntegrity.js';
import { bootstrapEventQuantities, parseNumericArray } from '../services/lmsr.js';
import { processMarketPayouts } from '../services/payouts.js';
import { recordAllEventSnapshots } from '../services/priceHistory.js';

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

    // Build a set of polymarket_ids that are already child markets of events.
    // These must NOT be created as standalone binary markets.
    const { rows: childRows } = await db.query(
      `SELECT polymarket_id FROM markets WHERE event_id IS NOT NULL`
    );
    const childPolyIds = new Set(childRows.map((r: { polymarket_id: string }) => r.polymarket_id));

    let inserted = 0;
    let skippedChildren = 0;
    const fetchedIds = new Set<string>();
    for (const m of markets) {
      fetchedIds.add(m.polymarket_id);

      // Skip if this market already exists as a child of a multi-outcome event
      if (childPolyIds.has(m.polymarket_id)) {
        skippedChildren++;
        continue;
      }

      // Also skip if this market's question closely matches an existing event title
      // (catches cases where the polymarket_id differs but the market is clearly
      // a duplicate of an event outcome)
      const questionPrefix = m.question.slice(0, 60).replace(/'/g, "''");
      if (questionPrefix.length >= 60) {
        const { rows: titleMatch } = await db.query(
          `SELECT 1 FROM events WHERE LOWER(title) LIKE LOWER($1) LIMIT 1`,
          [`%${questionPrefix}%`]
        );
        if (titleMatch.length > 0) {
          skippedChildren++;
          continue;
        }
      }

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

    console.log(`[cron] Synced ${synced} markets from API (${inserted} new, ${synced - inserted} updated, ${skippedChildren} skipped as event children).`);

    // ── Sync multi-outcome events ─────────────────────────────────────────
    const events = await fetchPolymarketEvents();
    let eventsSynced = 0;
    let childrenSynced = 0;
    let eventsReinitialized = 0;
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
             initial_probs  = EXCLUDED.initial_probs,
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

      // Fix parent event closes_at: use the latest child closes_at if it's newer
      // (Polymarket's event endDate can be stale/wrong)
      await db.query(
        `UPDATE events SET closes_at = GREATEST(events.closes_at,
           (SELECT MAX(m.closes_at) FROM markets m WHERE m.event_id = $1))
         WHERE id = $1`,
        [eventId]
      );

      // Detect event type
      // Sort by polymarket_id for deterministic index alignment with quantities vector
      const sortedChildren = [...evt.child_markets].sort((a, b) => a.polymarket_id.localeCompare(b.polymarket_id));
      const childProbs = sortedChildren.map((child) => {
        const yesProb = child.initial_probs[0] ?? 0;
        return Math.min(Math.max(yesProb, 0.001), 0.999);
      });
      const probSum = childProbs.reduce((a, v) => a + v, 0);

      // Detect heterogeneous sports prop events (moneyline + player props + spreads mixed together)
      const PROP_PATTERNS = /\b(O\/U|Spread|Moneyline|Points O\/U|Rebounds|Assists|1H|Over\/Under|Total Points|Three Pointers|Steals|Blocks|Turnovers)\b/i;
      const labels = evt.child_markets.map((c) => c.outcome_label);
      const hasPropMarkets = labels.some((l) => PROP_PATTERNS.test(l));
      const isMixedSportsProps = hasPropMarkets && labels.length > 8;

      // Detect date-based sequential/cumulative events ("by March", "by June", "by December")
      const DATE_PATTERNS = /\b(by\s+(January|February|March|April|May|June|July|August|September|October|November|December|Q[1-4]|20\d{2})|\d{4}$)/i;
      const hasDateLabels = labels.some((l) => DATE_PATTERNS.test(l));

      let eventType: string;
      if (isMixedSportsProps) {
        eventType = 'sports_props';
      } else if (hasDateLabels) {
        // Date-based sequential events: cumulative thresholds, not mutually exclusive
        eventType = 'independent';
      } else if (probSum > 1.1 || probSum < 0.5) {
        // Probs far from 1.0 in either direction → independent outcomes
        eventType = 'independent';
      } else {
        eventType = 'mutually_exclusive';
      }

      // Re-initialise event LMSR from current Polymarket prices when no agents have bet.
      const { rows: [evtState] } = await db.query(
        'SELECT active_agent_count FROM events WHERE id = $1',
        [eventId]
      );
      const hasAgentActivity = Number(evtState.active_agent_count ?? 0) > 0;

      if (!hasAgentActivity) {
        eventsReinitialized++;
        if (eventType === 'mutually_exclusive') {
          const BASE_B = 200;
          const eventQuantities = bootstrapEventQuantities(childProbs, BASE_B);
          await db.query(
            `UPDATE events SET quantities = $1, base_b = $2, lmsr_b = $2, active_agent_count = 0, event_type = $4 WHERE id = $3`,
            [eventQuantities, BASE_B, eventId, eventType]
          );
        } else {
          // Independent or sports_props: no event-level quantities
          await db.query(
            `UPDATE events SET quantities = NULL, event_type = $2, active_agent_count = 0 WHERE id = $1`,
            [eventId, eventType]
          );
        }
      } else {
        // Agents have bet — only update event_type, never touch quantities
        await db.query(
          `UPDATE events SET event_type = $1 WHERE id = $2`,
          [eventType, eventId]
        );
      }

      eventsSynced++;
    }
    console.log(`[cron] Synced ${eventsSynced} events with ${childrenSynced} child markets. Re-initialised ${eventsReinitialized} events from current Polymarket prices.`);

    // Verify: count markets with/without event_id
    const { rows: [eidCounts] } = await db.query(
      `SELECT COUNT(event_id)::int AS with_eid, (COUNT(*) - COUNT(event_id))::int AS without_eid FROM markets`
    );
    console.log(`[cron] Markets: ${eidCounts.with_eid} with event_id, ${eidCounts.without_eid} standalone.`);

    // ── Cleanup: resolve standalone duplicates of event child markets ────
    // If a polymarket_id exists as BOTH a standalone (event_id IS NULL) and
    // a child (event_id IS NOT NULL), resolve the standalone version.
    const { rowCount: dupesCleaned } = await db.query(
      `UPDATE markets SET resolved = true, updated_at = NOW()
       WHERE event_id IS NULL AND polymarket_id IN (
         SELECT polymarket_id FROM markets WHERE event_id IS NOT NULL
       )`
    );
    if (dupesCleaned && dupesCleaned > 0) {
      console.log(`[cron] Dedup: resolved ${dupesCleaned} standalone markets that are also event children.`);
    }

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

    // ── Aggressive time-to-close + quality cleanup ─────────────────────
    // Applies to ALL active standalone markets and events every sync cycle.
    // ≤3 days: keep regardless of volume
    // 3-7 days: deactivate unless volume > $2M
    // >7 days: deactivate unless volume > $10M
    const MIN_VOL_DEFAULT = 500_000;
    const MIN_VOL_CRYPTO_MACRO = 50_000;
    const VOL_THRESHOLD_SOON = 2_000_000;     // 3-7 days
    const VOL_THRESHOLD_DISTANT = 10_000_000;  // >7 days
    const GOOD_KEYWORDS = /\b(CPI|NFP|Fed|GDP|PCE|earnings|beat|rate|inflation|jobs|unemployment|Bitcoin|BTC|ETH|price|above|below|pass|vote|decision|announce|release|report|election|poll|approve|sign|deal|agreement|cut|hike|hold|default|launch|IPO|merge|acquire)\b/i;

    const now = Date.now();

    // ── Standalone markets cleanup ──
    const { rows: allMarkets } = await db.query(
      `SELECT id, question, category, volume, initial_probs, closes_at FROM markets WHERE resolved = false AND event_id IS NULL`
    );
    let cleaned = 0;
    for (const row of allMarkets) {
      const vol = typeof row.volume === 'string' ? parseFloat(row.volume) : row.volume;
      const probs: number[] = Array.isArray(row.initial_probs) ? row.initial_probs : [];
      const cat = row.category as string;
      const minVol = (cat === 'CRYPTO' || cat === 'MACRO') ? MIN_VOL_CRYPTO_MACRO : MIN_VOL_DEFAULT;
      const daysToClose = row.closes_at ? (new Date(row.closes_at).getTime() - now) / 86_400_000 : 999;

      // Quality filters
      if (isExcludedCategory(cat) || isF1Market(row.question) || vol < minVol || isLowQualityMarket(row.question, probs, row.closes_at)) {
        await db.query('UPDATE markets SET resolved = true, updated_at = NOW() WHERE id = $1', [row.id]);
        cleaned++;
        continue;
      }

      // Keyword relevance filter
      if (!GOOD_KEYWORDS.test(row.question)) {
        await db.query('UPDATE markets SET resolved = true, updated_at = NOW() WHERE id = $1', [row.id]);
        cleaned++;
        continue;
      }

      // Time-to-close volume gates (≤3 days always kept)
      if (daysToClose > 7 && vol < VOL_THRESHOLD_DISTANT) {
        await db.query('UPDATE markets SET resolved = true, updated_at = NOW() WHERE id = $1', [row.id]);
        cleaned++;
        continue;
      }
      if (daysToClose > 3 && vol < VOL_THRESHOLD_SOON) {
        await db.query('UPDATE markets SET resolved = true, updated_at = NOW() WHERE id = $1', [row.id]);
        cleaned++;
        continue;
      }
    }
    if (cleaned > 0) {
      console.log(`[cron] Cleanup: resolved ${cleaned} standalone markets that fail quality/time/keyword filters.`);
    }

    // ── Events cleanup: same time-to-close volume gates ──
    const { rows: allEvents } = await db.query(
      `SELECT id, title, volume, closes_at FROM events WHERE resolved = false`
    );
    let eventsCleaned = 0;
    for (const evt of allEvents) {
      const vol = typeof evt.volume === 'string' ? parseFloat(evt.volume) : evt.volume;
      const daysToClose = evt.closes_at ? (new Date(evt.closes_at).getTime() - now) / 86_400_000 : 999;

      if (daysToClose > 7 && vol < VOL_THRESHOLD_DISTANT) {
        await db.query('UPDATE events SET resolved = true, updated_at = NOW() WHERE id = $1', [evt.id]);
        await db.query('UPDATE markets SET resolved = true, updated_at = NOW() WHERE event_id = $1', [evt.id]);
        eventsCleaned++;
        continue;
      }
      if (daysToClose > 3 && vol < VOL_THRESHOLD_SOON) {
        await db.query('UPDATE events SET resolved = true, updated_at = NOW() WHERE id = $1', [evt.id]);
        await db.query('UPDATE markets SET resolved = true, updated_at = NOW() WHERE event_id = $1', [evt.id]);
        eventsCleaned++;
        continue;
      }
    }
    if (eventsCleaned > 0) {
      console.log(`[cron] Cleanup: resolved ${eventsCleaned} events that fail time-to-close volume gates.`);
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
        `SELECT id, polymarket_id, question, event_id FROM markets
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
          // Process payouts for this market
          await processMarketPayouts(db, m.id, winner);
          // If this is a child market, check if parent event should resolve
          if (m.event_id) {
            await checkEventResolution(db, m.event_id);
          }
        }
      }
      console.log(`[cron] Backfill bulk: ${settled.length} settled on Polymarket, ${dbMatches.length} matched our DB.`);
    }

    // --- B) Per-market check for our resolved markets still missing outcome ---
    const { rows: missingOutcome } = await db.query(
      `SELECT id, polymarket_id, question, event_id FROM markets
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
          await processMarketPayouts(db, m.id, status.winningOutcome);
          if (m.event_id) {
            await checkEventResolution(db, m.event_id);
          }
        }
      }
      console.log(`[cron] Backfill per-market: checked ${missingOutcome.length}, still awaiting Polymarket settlement.`);
    }

    if (totalFilled > 0) {
      console.log(`[cron] Backfill total: ${totalFilled} winning outcomes set.`);
    }

    // ── Backfill: activate resolved markets that pass all filters ───────
    // Prioritise ≤3 days (all volume), then 3-7d (>$2M), then >7d (>$10M).
    const TARGET_ACTIVE = 150;

    const { rows: [{ event_count }] } = await db.query(
      `SELECT COUNT(*)::int AS event_count FROM events WHERE resolved = false`
    );
    const { rows: [{ standalone_count }] } = await db.query(
      `SELECT COUNT(*)::int AS standalone_count FROM markets WHERE resolved = false AND event_id IS NULL`
    );
    const currentActive = (standalone_count as number) + (event_count as number);

    if (currentActive < TARGET_ACTIVE) {
      const slotsAvailable = TARGET_ACTIVE - currentActive;

      // Candidates: resolved standalone markets still live on Polymarket, passing keyword filter
      // Ordered by time-to-close ASC (soonest first), then volume DESC
      const { rows: candidates } = await db.query(
        `SELECT id, polymarket_id, question, volume, closes_at FROM markets
         WHERE resolved = true AND event_id IS NULL AND closes_at > NOW()
         ORDER BY closes_at ASC, volume DESC`
      );

      let activated = 0;
      for (const c of candidates) {
        if (activated >= slotsAvailable) break;
        if (!fetchedIds.has(c.polymarket_id)) continue;
        if (!GOOD_KEYWORDS.test(c.question)) continue;

        const vol = typeof c.volume === 'string' ? parseFloat(c.volume) : c.volume;
        const daysToClose = c.closes_at ? (new Date(c.closes_at).getTime() - now) / 86_400_000 : 999;

        // Apply same volume gates as cleanup
        if (daysToClose > 7 && vol < VOL_THRESHOLD_DISTANT) continue;
        if (daysToClose > 3 && vol < VOL_THRESHOLD_SOON) continue;

        await db.query('UPDATE markets SET resolved = false, updated_at = NOW() WHERE id = $1', [c.id]);
        activated++;
      }

      if (activated > 0) {
        console.log(`[cron] Backfill: activated ${activated} markets (${currentActive} → ${currentActive + activated}).`);
      }
    }

    // Record price history snapshots for sparkline charts
    const snapshots = await recordAllEventSnapshots(db).catch(() => 0);
    if (snapshots > 0) {
      console.log(`[cron] Recorded price snapshots for ${snapshots} events.`);
    }

    await logCategoryCounts(db, 'After sync');
  } catch (err) {
    // API fetch failed — record failure for circuit breaker
    await recordApiFailure(redis).catch(() => {});
    console.error('[cron] Market sync failed:', err);
  }
}
