import type { FastifyInstance } from 'fastify';
import { lmsrProbs } from '../services/lmsr.js';

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

    // For each event, fetch child markets and compute outcomes
    const result = await Promise.all(events.map(async (evt) => {
      const { rows: children } = await app.db.query(
        `SELECT m.id, m.outcome_label, m.volume, m.quantities, m.b_parameter,
                COUNT(b.id)::int AS bet_count
         FROM markets m
         LEFT JOIN bets b ON b.market_id = m.id
         WHERE m.event_id = $1 AND m.resolved = false
         GROUP BY m.id
         ORDER BY m.volume DESC`,
        [evt.id]
      );

      const outcomes = children.map((child) => {
        const probs = lmsrProbs(
          (child.quantities as number[]).map(Number),
          Number(child.b_parameter)
        );
        return {
          market_id: child.id,
          label: child.outcome_label,
          probability: probs[0], // Yes probability = probability of this outcome
          volume: Number(child.volume),
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
        outcomes,
        bet_count: totalBets,
      };
    }));

    return reply.send(result);
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
      `SELECT m.id, m.outcome_label, m.volume, m.quantities, m.b_parameter
       FROM markets m
       WHERE m.event_id = $1
       ORDER BY m.volume DESC`,
      [id]
    );

    const outcomes = children.map((child) => {
      const probs = lmsrProbs(
        (child.quantities as number[]).map(Number),
        Number(child.b_parameter)
      );
      return {
        market_id: child.id,
        label: child.outcome_label,
        probability: probs[0],
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
      outcomes,
      bets,
    });
  });
}
