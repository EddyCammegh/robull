import type { Pool, PoolClient } from 'pg';
import { lmsrProbs, computeMultiOutcomePrice, computeDynamicB, parseNumericArray } from './lmsr.js';

/**
 * Record a price snapshot for all outcomes of a standalone binary market.
 */
export async function recordMarketSnapshot(
  db: Pool | PoolClient,
  marketId: string,
  quantities: number[],
  b: number,
  source: 'sync' | 'bet',
): Promise<void> {
  const probs = lmsrProbs(quantities, b);
  const values: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < probs.length; i++) {
    const offset = i * 4;
    values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
    params.push(marketId, i, probs[i], source);
  }
  if (values.length === 0) return;
  await db.query(
    `INSERT INTO price_history (market_id, outcome_index, probability, source) VALUES ${values.join(',')}`,
    params,
  );
}

/**
 * Record a price snapshot for all outcomes of a multi-outcome event.
 */
export async function recordEventSnapshot(
  db: Pool | PoolClient,
  eventId: string,
  probs: number[],
  source: 'sync' | 'bet',
): Promise<void> {
  const values: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < probs.length; i++) {
    const offset = i * 4;
    values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
    params.push(eventId, i, probs[i], source);
  }
  if (values.length === 0) return;
  await db.query(
    `INSERT INTO price_history (event_id, outcome_index, probability, source) VALUES ${values.join(',')}`,
    params,
  );
}

/**
 * Record snapshots for ALL active events. Called after market sync.
 */
export async function recordAllEventSnapshots(db: Pool): Promise<number> {
  const { rows: events } = await db.query(
    `SELECT e.id, e.quantities, e.base_b, e.active_agent_count, e.event_type
     FROM events e WHERE e.resolved = false`
  );

  let recorded = 0;
  for (const evt of events) {
    const eventType = evt.event_type ?? 'mutually_exclusive';
    const isIndependent = eventType === 'independent' || eventType === 'sports_props';

    if (isIndependent) {
      // For independent events, snapshot each child's binary LMSR
      const { rows: children } = await db.query(
        `SELECT id, quantities, b_parameter FROM markets
         WHERE event_id = $1 AND resolved = false
         ORDER BY polymarket_id ASC`,
        [evt.id]
      );
      const probs = children.map((c) => {
        const q = parseNumericArray(c.quantities);
        const b = Number(c.b_parameter);
        const p = lmsrProbs(q, b);
        return p[0] ?? 0;
      });
      if (probs.length > 0) {
        await recordEventSnapshot(db, evt.id, probs, 'sync');
        recorded++;
      }
    } else {
      // Mutually exclusive: use event-level quantities
      const quantities = parseNumericArray(evt.quantities);
      if (quantities.length > 0) {
        const activeCount = Math.max(Number(evt.active_agent_count ?? 0), 1);
        const baseB = Number(evt.base_b ?? 200);
        const dynamicB = computeDynamicB(baseB, activeCount);
        try {
          const probs = computeMultiOutcomePrice(quantities, dynamicB);
          await recordEventSnapshot(db, evt.id, probs, 'sync');
          recorded++;
        } catch {
          // skip events with broken LMSR
        }
      }
    }
  }
  return recorded;
}
