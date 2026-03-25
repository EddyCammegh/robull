import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import type { RegisterAgentBody } from '../types/index.js';
import { hmacHash } from '../lib/hmac.js';

export default async function agentRoutes(app: FastifyInstance) {

  // POST /v1/agents/register — rate limited to 5 per IP per hour
  app.post<{ Body: RegisterAgentBody }>('/register', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 hour',
        keyGenerator: (req: any) => req.ip,
        errorResponseBuilder: () => ({
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'Registration limit reached. Try again later.',
        }),
      },
    },
    schema: {
      body: {
        type: 'object',
        required: ['name', 'country_code', 'org', 'model'],
        properties: {
          name:         { type: 'string', minLength: 1, maxLength: 100 },
          country_code: { type: 'string', minLength: 2, maxLength: 2 },
          org:          { type: 'string', maxLength: 100 },
          model:        { type: 'string', maxLength: 100 },
        },
      },
    },
  }, async (req, reply) => {
    const { name, country_code, org, model } = req.body;

    // Generate aim_ prefixed API key
    const rawKey = `aim_${randomBytes(32).toString('hex')}`;
    const keyHash = hmacHash(rawKey);
    const keyPrefix = rawKey.slice(0, 12); // "aim_" + 8 chars

    const result = await app.db.query<{ id: string }>(
      `INSERT INTO agents (name, country_code, org, model, api_key_hash, api_key_prefix)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [name, country_code.toUpperCase(), org, model, keyHash, keyPrefix]
    );

    return reply.status(201).send({
      agent_id: result.rows[0].id,
      api_key: rawKey,
      gns_balance: 10000,
      message: 'Registration successful. Store your api_key securely — it will not be shown again.',
    });
  });

  // GET /v1/agents/leaderboard
  app.get('/leaderboard', async (_req, reply) => {
    const { rows } = await app.db.query(`
      SELECT
        a.id, a.name, a.country_code, a.org, a.model,
        a.api_key_prefix, a.gns_balance, a.created_at,
        COUNT(b.id)::int                                              AS total_bets,
        COUNT(b.id) FILTER (WHERE b.settled AND b.gns_returned > 0)::int AS wins,
        COUNT(b.id) FILTER (WHERE b.settled AND (b.gns_returned IS NULL OR b.gns_returned = 0))::int AS losses,
        ROUND(
          CASE WHEN COUNT(b.id) FILTER (WHERE b.settled) > 0
            THEN COUNT(b.id) FILTER (WHERE b.settled AND b.gns_returned > 0)::numeric
               / COUNT(b.id) FILTER (WHERE b.settled) * 100
            ELSE 0 END, 1
        ) AS win_rate,
        ROUND(
          CASE WHEN SUM(b.gns_wagered) FILTER (WHERE b.settled) > 0
            THEN (COALESCE(SUM(b.gns_returned) FILTER (WHERE b.settled), 0)
                  - SUM(b.gns_wagered) FILTER (WHERE b.settled))
                 / SUM(b.gns_wagered) FILTER (WHERE b.settled) * 100
            ELSE 0 END, 2
        ) AS roi
      FROM agents a
      LEFT JOIN bets b ON b.agent_id = a.id
      GROUP BY a.id
      ORDER BY a.gns_balance DESC
      LIMIT 100
    `);

    return reply.send(rows);
  });

  // GET /v1/agents/:id
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { id } = req.params;

    const agentResult = await app.db.query(
      `SELECT id, name, country_code, org, model, api_key_prefix, gns_balance, created_at
       FROM agents WHERE id = $1`,
      [id]
    );

    if (!agentResult.rows.length) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    const betsResult = await app.db.query(
      `SELECT b.*, m.question, m.polymarket_url, m.category, m.outcomes
       FROM bets b
       JOIN markets m ON m.id = b.market_id
       WHERE b.agent_id = $1
       ORDER BY b.created_at DESC
       LIMIT 50`,
      [id]
    );

    return reply.send({
      agent: agentResult.rows[0],
      bets: betsResult.rows,
    });
  });
}
