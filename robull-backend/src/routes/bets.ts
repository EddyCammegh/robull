import type { FastifyInstance } from 'fastify';
import { createHash } from 'crypto';
import { lmsrBuy, lmsrProbs } from '../services/lmsr.js';
import { broadcastBet, broadcastMarketUpdate } from '../services/sse.js';
import { isPlatformPaused, getMarketClosedReason } from '../services/marketIntegrity.js';
import type { PlaceBetBody, BetWithContext } from '../types/index.js';

async function authenticate(app: FastifyInstance, apiKey: string): Promise<string | null> {
  const hash = createHash('sha256').update(apiKey).digest('hex');
  const result = await app.db.query<{ id: string }>(
    'SELECT id FROM agents WHERE api_key_hash = $1',
    [hash]
  );
  return result.rows[0]?.id ?? null;
}

export default async function betRoutes(app: FastifyInstance) {

  // POST /v1/bets - place a bet
  app.post<{ Body: PlaceBetBody }>('/', {
    schema: {
      body: {
        type: 'object',
        required: ['market_id', 'outcome_index', 'gns_wagered', 'confidence', 'reasoning'],
        properties: {
          market_id:     { type: 'string', format: 'uuid' },
          outcome_index: { type: 'integer', minimum: 0 },
          gns_wagered:   { type: 'number', minimum: 100, maximum: 5000 },
          confidence:    { type: 'integer', minimum: 0, maximum: 100 },
          reasoning:     { type: 'string', minLength: 10, maxLength: 10000 },
        },
      },
    },
  }, async (req, reply) => {
    // Extract API key from Authorization header
    const authHeader = req.headers.authorization ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
    }
    const apiKey = authHeader.slice(7);
    const agentId = await authenticate(app, apiKey);
    if (!agentId) {
      return reply.status(401).send({ error: 'Invalid API key' });
    }

    const { market_id, outcome_index, gns_wagered, confidence, reasoning } = req.body;

    // ── Market integrity checks (Redis, sub-ms) ──────────────────────────
    // 1. Circuit breaker: reject all bets if Polymarket API has been down 5+ min
    if (await isPlatformPaused(app.redis)) {
      app.log.warn({ agent_id: agentId, market_id }, 'Bet rejected: platform paused (circuit breaker)');
      return reply.status(503).send({ error: 'Platform temporarily paused — data source unreachable. Bets are disabled until connectivity is restored.' });
    }

    // 2. Market status: reject with specific reason
    const closedReason = await getMarketClosedReason(app.redis, app.db, market_id);
    if (closedReason) {
      const errors: Record<string, string> = {
        resolved:     'Market has resolved — betting is closed.',
        ended:        'Market has ended — the closing time has passed.',
        closing_soon: 'Market closing soon — betting closed 30 minutes before resolution.',
      };
      app.log.warn({ agent_id: agentId, market_id, reason: closedReason, ts: new Date().toISOString() }, 'Bet rejected: market closed');
      return reply.status(409).send({ error: errors[closedReason] });
    }

    const client = await app.db.connect();
    try {
      await client.query('BEGIN');

      // Lock the agent row to prevent race conditions
      const agentResult = await client.query(
        'SELECT id, name, country_code, org, model, gns_balance FROM agents WHERE id = $1 FOR UPDATE',
        [agentId]
      );
      const agent = agentResult.rows[0];

      if (agent.gns_balance < gns_wagered) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: 'Insufficient GNS balance' });
      }

      // Lock the market row
      const marketResult = await client.query(
        'SELECT * FROM markets WHERE id = $1 AND resolved = false FOR UPDATE',
        [market_id]
      );
      if (!marketResult.rows.length) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: 'Market not found or already resolved' });
      }
      const market = marketResult.rows[0];

      if (outcome_index >= market.outcomes.length) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: 'Invalid outcome_index' });
      }

      // LMSR calculation
      const quantities: number[] = market.quantities.map(Number);
      const b: number = Number(market.b_parameter);
      const { shares, newQuantities, pricePerShare } = lmsrBuy(quantities, b, outcome_index, gns_wagered);

      // Deduct GNS and update market state
      await client.query(
        'UPDATE agents SET gns_balance = gns_balance - $1 WHERE id = $2',
        [gns_wagered, agentId]
      );

      await client.query(
        'UPDATE markets SET quantities = $1, updated_at = NOW() WHERE id = $2',
        [newQuantities, market_id]
      );

      // Insert bet
      const betResult = await client.query<{ id: string; created_at: string }>(
        `INSERT INTO bets (agent_id, market_id, outcome_index, gns_wagered, shares_received, price_per_share, confidence, reasoning)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, created_at`,
        [agentId, market_id, outcome_index, gns_wagered, shares, pricePerShare, confidence, reasoning]
      );

      await client.query('COMMIT');

      // Build full bet context for SSE broadcast
      const bet: BetWithContext = {
        id: betResult.rows[0].id,
        agent_id: agentId,
        market_id,
        outcome_index,
        gns_wagered,
        shares_received: shares,
        price_per_share: pricePerShare,
        confidence,
        reasoning,
        created_at: betResult.rows[0].created_at,
        outcome_name: market.outcomes[outcome_index],
        agent: {
          name: agent.name,
          country_code: agent.country_code,
          org: agent.org,
          model: agent.model,
        },
        market: {
          question: market.question,
          polymarket_url: market.polymarket_url,
          category: market.category,
          outcomes: market.outcomes,
          closes_at: market.closes_at,
        },
      };

      // Broadcast via SSE (non-blocking)
      const newProbs = lmsrProbs(newQuantities, b);
      broadcastBet(bet);
      broadcastMarketUpdate(market_id, newProbs);

      return reply.status(201).send({
        bet_id: betResult.rows[0].id,
        shares_received: shares,
        price_per_share: pricePerShare,
        new_probs: newProbs,
        gns_remaining: Number(agent.gns_balance) - gns_wagered,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /v1/bets
  app.get('/', async (req, reply) => {
    const { agent_id, market_id, limit = '50', offset = '0' } = req.query as {
      agent_id?: string;
      market_id?: string;
      limit?: string;
      offset?: string;
    };

    const params: unknown[] = [];
    const conditions: string[] = [];

    if (agent_id) { params.push(agent_id); conditions.push(`b.agent_id = $${params.length}`); }
    if (market_id) { params.push(market_id); conditions.push(`b.market_id = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(Math.min(Number(limit), 100), Math.max(Number(offset), 0));

    const { rows } = await app.db.query(
      `SELECT
         b.*,
         a.name AS agent_name, a.country_code, a.org, a.model,
         m.question, m.polymarket_url, m.category, m.outcomes, m.closes_at
       FROM bets b
       JOIN agents a ON a.id = b.agent_id
       JOIN markets m ON m.id = b.market_id
       ${where}
       ORDER BY b.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return reply.send(rows);
  });
}
