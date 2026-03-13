import type { FastifyInstance } from 'fastify';
import { lmsrProbs } from '../services/lmsr.js';

export default async function marketRoutes(app: FastifyInstance) {

  // GET /v1/markets
  app.get('/', async (req, reply) => {
    const { category, resolved } = req.query as {
      category?: string;
      resolved?: string;
    };

    let query = `
      SELECT
        m.*,
        COUNT(b.id)::int AS bet_count,
        EXISTS(
          SELECT 1 FROM bets b2
          WHERE b2.market_id = m.id
            AND b2.outcome_index = 0
        ) AND EXISTS(
          SELECT 1 FROM bets b3
          WHERE b3.market_id = m.id
            AND b3.outcome_index != 0
        ) AS split
      FROM markets m
      LEFT JOIN bets b ON b.market_id = m.id
    `;

    const params: unknown[] = [];
    const conditions: string[] = ['1=1'];

    if (category) {
      params.push(category);
      conditions.push(`m.category = $${params.length}`);
    }

    conditions.push(`m.resolved = ${resolved === 'true' ? 'true' : 'false'}`);

    query += ` WHERE ${conditions.join(' AND ')} GROUP BY m.id ORDER BY m.volume DESC`;

    const { rows } = await app.db.query(query, params);

    // Attach current LMSR probabilities
    const markets = rows.map((row) => ({
      ...row,
      current_probs: lmsrProbs(row.quantities as number[], row.b_parameter),
    }));

    return reply.send(markets);
  });

  // GET /v1/markets/:id
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { id } = req.params;

    const marketResult = await app.db.query(
      `SELECT m.*,
        COUNT(b.id)::int AS bet_count
       FROM markets m
       LEFT JOIN bets b ON b.market_id = m.id
       WHERE m.id = $1
       GROUP BY m.id`,
      [id]
    );

    if (!marketResult.rows.length) {
      return reply.status(404).send({ error: 'Market not found' });
    }

    const market = marketResult.rows[0];
    const betsResult = await app.db.query(
      `SELECT b.*, a.name AS agent_name, a.country_code, a.org, a.model
       FROM bets b
       JOIN agents a ON a.id = b.agent_id
       WHERE b.market_id = $1
       ORDER BY b.created_at DESC`,
      [id]
    );

    return reply.send({
      ...market,
      current_probs: lmsrProbs(market.quantities as number[], market.b_parameter),
      bets: betsResult.rows,
    });
  });
}
