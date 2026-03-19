import type { FastifyInstance } from 'fastify';
import { lmsrProbs, computeMultiOutcomePrice, computeDynamicB } from '../services/lmsr.js';

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
         WHERE m.event_id = $1
         GROUP BY m.id
         ORDER BY m.volume DESC`,
        [evt.id]
      );

      const eventQuantities: number[] | null = evt.quantities?.map(Number) ?? null;
      const activeAgentCount = Number(evt.active_agent_count ?? 0);
      const baseB = Number(evt.base_b ?? 200);
      const dynamicB = computeDynamicB(baseB, Math.max(activeAgentCount, 1));

      // Compute event-level probabilities from native LMSR if initialized
      let eventProbs: number[] | null = null;
      if (eventQuantities && eventQuantities.length === children.length) {
        eventProbs = computeMultiOutcomePrice(eventQuantities, dynamicB);
      }

      const outcomes = children.map((child, idx) => {
        // Polymarket probability (from child market Yes price)
        const childProbs = lmsrProbs(
          (child.quantities as number[]).map(Number),
          Number(child.b_parameter)
        );
        const polymarketProb = Number(child.initial_probs?.[0] ?? childProbs[0]);

        // Robull probability: use event-level LMSR if available, else fall back to child
        const robullProb = eventProbs ? eventProbs[idx] : childProbs[0];

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
        active_agent_count: activeAgentCount,
        lmsr_b: dynamicB,
        outcomes,
        bet_count: totalBets,
      };
    }));

    // Only return events that have at least 2 active outcomes
    return reply.send(result.filter(e => e.outcomes.length >= 2));
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
      `SELECT m.id, m.outcome_label, m.volume, m.quantities, m.b_parameter, m.initial_probs
       FROM markets m
       WHERE m.event_id = $1
       ORDER BY m.volume DESC`,
      [id]
    );

    const eventQuantities: number[] | null = evt.quantities?.map(Number) ?? null;
    const activeAgentCount = Number(evt.active_agent_count ?? 0);
    const baseB = Number(evt.base_b ?? 200);
    const dynamicB = computeDynamicB(baseB, Math.max(activeAgentCount, 1));

    let eventProbs: number[] | null = null;
    if (eventQuantities && eventQuantities.length === children.length) {
      eventProbs = computeMultiOutcomePrice(eventQuantities, dynamicB);
    }

    const outcomes = children.map((child, idx) => {
      const childProbs = lmsrProbs(
        (child.quantities as number[]).map(Number),
        Number(child.b_parameter)
      );
      const polymarketProb = Number(child.initial_probs?.[0] ?? childProbs[0]);
      const robullProb = eventProbs ? eventProbs[idx] : childProbs[0];

      return {
        market_id: child.id,
        label: child.outcome_label,
        probability: robullProb,
        polymarket_probability: polymarketProb,
        divergence: robullProb - polymarketProb,
        volume: Number(child.volume),
      };
    });

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
      active_agent_count: activeAgentCount,
      lmsr_b: dynamicB,
      outcomes,
      bets,
    });
  });
}
