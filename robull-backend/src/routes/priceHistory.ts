import type { FastifyInstance } from 'fastify';

export default async function priceHistoryRoutes(app: FastifyInstance) {
  // GET /v1/price-history?market_id=X  or  ?event_id=X
  app.get('/', async (req, reply) => {
    const { market_id, event_id, hours = '168' } = req.query as {
      market_id?: string;
      event_id?: string;
      hours?: string;
    };

    if (!market_id && !event_id) {
      return reply.status(400).send({ error: 'Provide market_id or event_id' });
    }

    const h = Math.min(Number(hours) || 168, 720); // max 30 days

    let rows: any[];
    if (event_id) {
      ({ rows } = await app.db.query(
        `SELECT outcome_index, probability, source, recorded_at
         FROM price_history
         WHERE event_id = $1 AND recorded_at > NOW() - INTERVAL '1 hour' * $2
         ORDER BY outcome_index, recorded_at ASC`,
        [event_id, h]
      ));
    } else {
      ({ rows } = await app.db.query(
        `SELECT outcome_index, probability, source, recorded_at
         FROM price_history
         WHERE market_id = $1 AND recorded_at > NOW() - INTERVAL '1 hour' * $2
         ORDER BY outcome_index, recorded_at ASC`,
        [market_id, h]
      ));
    }

    // Group by outcome_index
    const grouped: Record<number, { probability: number; recorded_at: string }[]> = {};
    for (const row of rows) {
      const idx = row.outcome_index;
      if (!grouped[idx]) grouped[idx] = [];
      grouped[idx].push({ probability: Number(row.probability), recorded_at: row.recorded_at });
    }

    return reply.send(grouped);
  });
}
