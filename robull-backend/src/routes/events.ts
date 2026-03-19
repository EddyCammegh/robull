import type { FastifyInstance } from 'fastify';
import { lmsrProbs, computeMultiOutcomePrice, computeDynamicB, parseNumericArray } from '../services/lmsr.js';

/**
 * Compute outcome probabilities for a single event.
 * - mutually_exclusive: use event-level multi-outcome LMSR (sums to 1.0)
 * - independent: use each child market's binary LMSR independently (may sum to >1.0)
 */
function computeOutcomes(evt: any, children: any[]) {
  const eventType = evt.event_type ?? 'mutually_exclusive';
  const isIndependent = eventType === 'independent';

  const eventQuantities = parseNumericArray(evt.quantities);
  const hasEventQuantities = eventQuantities.length > 0;
  const activeAgentCount = Number(evt.active_agent_count ?? 0);
  const baseB = Number(evt.base_b ?? 200);
  const dynamicB = computeDynamicB(baseB, Math.max(activeAgentCount, 1));

  // For mutually exclusive events: compute event-level LMSR probabilities
  let eventProbs: number[] | null = null;
  if (!isIndependent && hasEventQuantities && eventQuantities.length === children.length) {
    eventProbs = computeMultiOutcomePrice(eventQuantities, dynamicB);
  } else if (!isIndependent && hasEventQuantities) {
    console.warn(`[events] LMSR length mismatch for "${evt.title?.slice(0, 50)}": quantities=${eventQuantities.length}, children=${children.length}`);
  }

  const outcomes = children.map((child, idx) => {
    const childProbs = lmsrProbs(
      parseNumericArray(child.quantities),
      Number(child.b_parameter)
    );
    const initialProbs = parseNumericArray(child.initial_probs);
    const polymarketProb = initialProbs.length > 0 ? initialProbs[0] : childProbs[0];

    // For independent events: always use child market's own binary LMSR
    // For mutually exclusive: use event-level LMSR if available
    const robullProb = isIndependent
      ? childProbs[0]
      : (eventProbs ? eventProbs[idx] : childProbs[0]);

    return {
      market_id: child.id,
      label: child.outcome_label,
      probability: robullProb,
      polymarket_probability: polymarketProb,
      divergence: robullProb - polymarketProb,
      volume: Number(child.volume),
      closes_at: child.closes_at,
      resolved: child.child_resolved,
    };
  });

  return { outcomes, activeAgentCount, dynamicB, eventType };
}

export default async function eventRoutes(app: FastifyInstance) {

  // GET /v1/events — list grouped events with outcomes
  app.get('/', async (req, reply) => {
    const { category, resolved } = req.query as {
      category?: string;
      resolved?: string;
    };

    const params: unknown[] = [];
    const conditions: string[] = ['1=1'];

    if (category) {
      params.push(category);
      conditions.push(`e.category = $${params.length}`);
    }

    conditions.push(`e.resolved = ${resolved === 'true' ? 'true' : 'false'}`);

    const { rows: events } = await app.db.query(
      `SELECT e.*
       FROM events e
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.volume DESC`,
      params
    );

    const result = await Promise.all(events.map(async (evt) => {
      const { rows: children } = await app.db.query(
        `SELECT m.id, m.outcome_label, m.volume, m.quantities, m.b_parameter,
                m.initial_probs, m.closes_at, m.resolved AS child_resolved,
                COUNT(b.id)::int AS bet_count
         FROM markets m
         LEFT JOIN bets b ON b.market_id = m.id
         WHERE m.event_id = $1 AND m.resolved = false
         GROUP BY m.id
         ORDER BY m.volume DESC`,
        [evt.id]
      );

      const { outcomes, activeAgentCount, dynamicB, eventType } = computeOutcomes(evt, children);
      const totalBets = children.reduce((s, c) => s + c.bet_count, 0);

      return {
        id: evt.id,
        polymarket_event_id: evt.polymarket_event_id,
        title: evt.title,
        slug: evt.slug,
        category: evt.category,
        polymarket_url: evt.polymarket_url,
        volume: Number(evt.volume),
        closes_at: evt.closes_at,
        resolved: evt.resolved,
        winning_outcome_label: evt.winning_outcome_label,
        event_type: eventType,
        active_agent_count: activeAgentCount,
        lmsr_b: dynamicB,
        outcomes,
        bet_count: totalBets,
      };
    }));

    // Only return events that have at least 2 active outcomes
    return reply.send(result.filter(e => e.outcomes.length >= 2));
  });

  // GET /v1/debug/quantities — temporary debug endpoint
  app.get('/debug/quantities', async (_req, reply) => {
    const { rows: sample } = await app.db.query(`
      SELECT e.id, e.title, e.quantities, e.lmsr_b, e.base_b, e.active_agent_count, e.event_type,
             array_length(e.quantities, 1) AS qty_len,
             (SELECT COUNT(*)::int FROM markets m WHERE m.event_id = e.id AND m.resolved = false) AS child_count
      FROM events e
      LIMIT 5
    `);

    const debug = sample.map((row) => {
      const raw = row.quantities;
      const parsed = parseNumericArray(raw);
      const isAllZero = parsed.length > 0 ? parsed.every((v: number) => v === 0) : null;
      const hasNaN = parsed.length > 0 ? parsed.some((v: number) => isNaN(v)) : null;
      let probabilities: number[] | null = null;
      if (parsed.length > 0 && parsed.length === row.child_count && row.event_type !== 'independent') {
        try { probabilities = computeMultiOutcomePrice(parsed, Number(row.lmsr_b ?? 200)); } catch {}
      }

      return {
        id: row.id,
        title: row.title?.slice(0, 60),
        event_type: row.event_type,
        quantities_raw: raw,
        quantities_parsed: parsed,
        quantities_type: raw === null ? 'null' : typeof raw,
        quantities_isArray: Array.isArray(raw),
        qty_len: row.qty_len,
        child_count: row.child_count,
        lmsr_b: row.lmsr_b,
        base_b: row.base_b,
        active_agent_count: row.active_agent_count,
        is_all_zero: isAllZero,
        has_nan: hasNaN,
        probabilities,
        prob_sum: probabilities ? probabilities.reduce((a, v) => a + v, 0) : null,
        length_match: parsed.length > 0 ? parsed.length === row.child_count : false,
      };
    });

    const { rows: [counts] } = await app.db.query(`
      SELECT
        COUNT(*)::int AS total_events,
        COUNT(quantities)::int AS with_quantities,
        COUNT(CASE WHEN array_length(quantities, 1) > 0 THEN 1 END)::int AS with_nonempty_quantities,
        COUNT(CASE WHEN event_type = 'independent' THEN 1 END)::int AS independent_events,
        COUNT(CASE WHEN event_type = 'mutually_exclusive' THEN 1 END)::int AS mutually_exclusive_events,
        (SELECT COUNT(*)::int FROM markets WHERE event_id IS NOT NULL) AS child_markets,
        (SELECT COUNT(*)::int FROM markets WHERE event_id IS NULL AND resolved = false) AS standalone_markets
      FROM events
    `);

    return reply.send({ counts, sample: debug });
  });

  // GET /v1/events/:id — single event with outcomes and bets
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { id } = req.params;

    const { rows: [evt] } = await app.db.query(
      'SELECT * FROM events WHERE id = $1',
      [id]
    );
    if (!evt) {
      return reply.status(404).send({ error: 'Event not found' });
    }

    const { rows: children } = await app.db.query(
      `SELECT m.id, m.outcome_label, m.volume, m.quantities, m.b_parameter, m.initial_probs,
              m.closes_at, m.resolved AS child_resolved
       FROM markets m
       WHERE m.event_id = $1 AND m.resolved = false
       ORDER BY m.volume DESC`,
      [id]
    );

    const { outcomes, activeAgentCount, dynamicB, eventType } = computeOutcomes(evt, children);

    // Fetch all bets on any child market
    const childIds = children.map(c => c.id);
    const { rows: bets } = childIds.length > 0 ? await app.db.query(
      `SELECT b.*, a.name AS agent_name, a.country_code, a.org, a.model,
              m.outcome_label
       FROM bets b
       JOIN agents a ON a.id = b.agent_id
       JOIN markets m ON m.id = b.market_id
       WHERE b.market_id = ANY($1)
       ORDER BY b.created_at DESC`,
      [childIds]
    ) : { rows: [] };

    return reply.send({
      id: evt.id,
      polymarket_event_id: evt.polymarket_event_id,
      title: evt.title,
      slug: evt.slug,
      category: evt.category,
      polymarket_url: evt.polymarket_url,
      volume: Number(evt.volume),
      closes_at: evt.closes_at,
      resolved: evt.resolved,
      winning_outcome_label: evt.winning_outcome_label,
      event_type: eventType,
      active_agent_count: activeAgentCount,
      lmsr_b: dynamicB,
      outcomes,
      bets,
    });
  });
}
