import type { FastifyInstance } from 'fastify';
import { lmsrProbs, computeMultiOutcomePrice, computeDynamicB, parseNumericArray } from '../services/lmsr.js';

/**
 * Compute outcome probabilities for a single event.
 * Uses the full quantities vector from the event table — indices match the
 * original outcome order at initialisation time. Resolved/passed outcomes
 * remain in the probability calculation (their probability naturally
 * approaches 0 or 1).
 */
function computeOutcomes(evt: any, children: any[]) {
  const eventType = evt.event_type ?? 'mutually_exclusive';
  const isIndependent = eventType === 'independent' || eventType === 'sports_props';

  const eventQuantities = parseNumericArray(evt.quantities);
  const hasEventQuantities = eventQuantities.length > 0;
  const activeAgentCount = Number(evt.active_agent_count ?? 0);
  const baseB = Number(evt.base_b ?? 200);
  const dynamicB = computeDynamicB(baseB, Math.max(activeAgentCount, 1));

  // Compute event-level LMSR probabilities from stored quantities vector.
  // Use quantities.length — NOT children.length — since quantities is the
  // authoritative source that was set at initialisation.
  let eventProbs: number[] | null = null;
  if (!isIndependent && hasEventQuantities) {
    try {
      eventProbs = computeMultiOutcomePrice(eventQuantities, dynamicB);
    } catch (err) {
      console.warn(`[events] LMSR computation failed for "${evt.title?.slice(0, 50)}":`, err);
    }
  }

  const now = new Date();

  const outcomes = children.map((child, idx) => {
    const childProbs = lmsrProbs(
      parseNumericArray(child.quantities),
      Number(child.b_parameter)
    );
    const initialProbs = parseNumericArray(child.initial_probs);
    const polymarketProb = initialProbs.length > 0 ? initialProbs[0] : childProbs[0];

    const childResolved = child.child_resolved === true;
    const hasWinner = child.winning_outcome != null;
    const closedAt = child.closes_at ? new Date(child.closes_at) : null;
    const isExpired = closedAt !== null && closedAt < now;
    // Only mark as passed if genuinely settled (has winner) or actually expired
    const isPassed = (childResolved && hasWinner) || isExpired;

    // For independent events: use child market's own binary LMSR
    // For mutually exclusive: use event-level LMSR if available (idx must be in range)
    let robullProb: number;
    if (isIndependent) {
      robullProb = childProbs[0];
    } else if (eventProbs && idx < eventProbs.length) {
      robullProb = eventProbs[idx];
    } else {
      robullProb = childProbs[0];
    }

    return {
      market_id: child.id,
      label: child.outcome_label,
      probability: robullProb,
      polymarket_probability: polymarketProb,
      divergence: robullProb - polymarketProb,
      volume: Number(child.volume),
      closes_at: child.closes_at,
      active: !isPassed,
      passed: isPassed,
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

    // Only allowed categories
    conditions.push(`e.category IN ('POLITICS','CRYPTO','MACRO','AI/TECH')`);

    if (category) {
      params.push(category);
      conditions.push(`e.category = $${params.length}`);
    }

    conditions.push(`e.resolved = ${resolved === 'true' ? 'true' : 'false'}`);

    const { rows: events } = await app.db.query(
      `SELECT e.* FROM events e WHERE ${conditions.join(' AND ')} ORDER BY e.volume DESC`,
      params
    );

    const result = await Promise.all(events.map(async (evt) => {
      // Fetch ALL child markets — including resolved/passed ones.
      const { rows: children } = await app.db.query(
        `SELECT m.id, m.outcome_label, m.volume, m.quantities, m.b_parameter,
                m.initial_probs, m.closes_at, m.resolved AS child_resolved, m.winning_outcome,
                COUNT(b.id)::int AS bet_count
         FROM markets m
         LEFT JOIN bets b ON b.market_id = m.id
         WHERE m.event_id = $1
         GROUP BY m.id
         ORDER BY m.polymarket_id ASC`,
        [evt.id]
      );

      const { outcomes, activeAgentCount, dynamicB, eventType } = computeOutcomes(evt, children);
      const totalBets = children.reduce((s, c) => s + c.bet_count, 0);
      const activeOutcomes = outcomes.filter(o => o.active).length;

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
        active_outcomes: activeOutcomes,
        bet_count: totalBets,
      };
    }));

    return reply.send(result.filter(e => e.active_outcomes >= 1));
  });

  // GET /v1/events/:id/recent-bets — bets from last 3 hours for agent reply system
  app.get<{ Params: { id: string } }>('/:id/recent-bets', async (req, reply) => {
    const { rows: bets } = await app.db.query(
      `SELECT b.id, b.agent_id, b.outcome_index, b.gns_wagered, b.confidence,
              b.reasoning, b.created_at, b.parent_bet_id, b.reply_type, b.reply_to_agent,
              b.outcome_label,
              a.name AS agent_name, a.country_code, a.org, a.model,
              m.outcome_label AS market_outcome_label
       FROM bets b
       JOIN agents a ON a.id = b.agent_id
       JOIN markets m ON m.id = b.market_id
       WHERE m.event_id = $1
         AND b.created_at > NOW() - INTERVAL '3 hours'
       ORDER BY b.created_at DESC`,
      [req.params.id]
    );
    return reply.send(bets);
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

    // Fetch ALL child markets (including resolved/passed)
    const { rows: children } = await app.db.query(
      `SELECT m.id, m.outcome_label, m.volume, m.quantities, m.b_parameter, m.initial_probs,
              m.closes_at, m.resolved AS child_resolved, m.winning_outcome
       FROM markets m
       WHERE m.event_id = $1
       ORDER BY m.polymarket_id ASC`,
      [id]
    );

    const { outcomes, activeAgentCount, dynamicB, eventType } = computeOutcomes(evt, children);

    // Fetch all bets on any child market (including resolved ones for history)
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

    const activeOutcomes = outcomes.filter(o => o.active).length;

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
      active_outcomes: activeOutcomes,
      lmsr_b: dynamicB,
      outcomes,
      bets,
    });
  });
}
