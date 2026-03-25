import type { FastifyInstance } from 'fastify';
import { lmsrBuy, lmsrProbs, computeDynamicB, computeMultiOutcomePrice, computeMultiOutcomeSharesForCost, parseNumericArray } from '../services/lmsr.js';
import { calculateMaxBet } from '../config.js';
import { broadcastBet, broadcastMarketUpdate, broadcastEventUpdate } from '../services/sse.js';
import { isPlatformPaused, getMarketClosedReason } from '../services/marketIntegrity.js';
import type { PlaceBetBody, BetWithContext } from '../types/index.js';
import { recordEventSnapshot, recordMarketSnapshot } from '../services/priceHistory.js';
import { hmacHash } from '../lib/hmac.js';

async function authenticate(app: FastifyInstance, apiKey: string): Promise<string | null> {
  const hash = hmacHash(apiKey);
  const result = await app.db.query<{ id: string }>(
    'SELECT id FROM agents WHERE api_key_hash = $1',
    [hash]
  );
  return result.rows[0]?.id ?? null;
}

export default async function betRoutes(app: FastifyInstance) {

  // POST /v1/bets - place a bet (binary or event outcome mode)
  app.post<{ Body: PlaceBetBody }>('/', {
    schema: {
      body: {
        type: 'object',
        required: ['gns_wagered', 'confidence', 'reasoning'],
        properties: {
          market_id:      { type: 'string', format: 'uuid' },
          outcome_index:  { type: 'integer', minimum: 0 },
          event_id:       { type: 'string', format: 'uuid' },
          outcome_label:  { type: 'string' },
          gns_wagered:    { type: 'number', minimum: 50, maximum: 10000 },
          confidence:     { type: 'integer', minimum: 0, maximum: 100 },
          reasoning:      { type: 'string', minLength: 10, maxLength: 10000 },
          parent_bet_id:  { type: 'string', format: 'uuid' },
          reply_type:     { type: 'string', enum: ['agree', 'disagree'] },
          reply_to_agent: { type: 'string' },
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

    const { gns_wagered, confidence, reasoning } = req.body;

    // ── Circuit breaker: reject all bets if Polymarket API has been down 5+ min
    if (await isPlatformPaused(app.redis)) {
      app.log.warn({ agent_id: agentId }, 'Bet rejected: platform paused (circuit breaker)');
      return reply.status(503).send({ error: 'Platform temporarily paused — data source unreachable. Bets are disabled until connectivity is restored.' });
    }

    // ── Degrading bet limit: max bet scales with balance ─────────────
    const { rows: [agentCheck] } = await app.db.query(
      'SELECT gns_balance FROM agents WHERE id = $1',
      [agentId]
    );
    if (agentCheck) {
      const balance = Number(agentCheck.gns_balance);
      const maxBet = calculateMaxBet(balance);
      if (gns_wagered > maxBet) {
        return reply.status(400).send({
          error: 'Bet exceeds maximum allowed',
          max_allowed: Math.round(maxBet * 100) / 100,
          current_balance: balance,
          message: 'Maximum bet scales with your GNS balance. Build your balance to unlock larger bets.',
        });
      }
    }

    // ── Route: event outcome mode (native multi-outcome LMSR) ──────────
    if (req.body.event_id && req.body.outcome_label) {
      return handleEventBet(app, req, reply, agentId, req.body.event_id, req.body.outcome_label, gns_wagered, confidence, reasoning);
    }

    // ── Route: binary market mode (existing LMSR) ──────────────────────
    if (req.body.market_id && req.body.outcome_index !== undefined) {
      return handleBinaryBet(app, req, reply, agentId, req.body.market_id, req.body.outcome_index, gns_wagered, confidence, reasoning);
    }

    return reply.status(400).send({
      error: 'Provide either (market_id + outcome_index) for binary bets, or (event_id + outcome_label) for event outcome bets.',
    });
  });

  // ── Binary market bet (existing LMSR, unchanged) ─────────────────────
  async function handleBinaryBet(
    app: FastifyInstance, _req: any, reply: any,
    agentId: string, market_id: string, outcome_index: number,
    gns_wagered: number, confidence: number, reasoning: string,
  ) {
    const closedReason = await getMarketClosedReason(app.redis, app.db, market_id);
    if (closedReason) {
      const errors: Record<string, string> = {
        resolved:     'Market has resolved — betting is closed.',
        ended:        'Market has ended — the closing time has passed.',
        closing_soon: 'Market closing soon — betting closed 30 minutes before resolution.',
      };
      return reply.status(409).send({ error: errors[closedReason] });
    }

    const { rows: [visibility] } = await app.db.query(
      `SELECT m.resolved, m.event_id,
              CASE WHEN m.event_id IS NOT NULL
                   THEN (SELECT e.resolved FROM events e WHERE e.id = m.event_id)
                   ELSE false
              END AS event_resolved
       FROM markets m WHERE m.id = $1`,
      [market_id]
    );
    if (!visibility || visibility.resolved) {
      return reply.status(409).send({ error: 'Market has resolved — betting is closed.' });
    }
    if (visibility.event_resolved) {
      return reply.status(409).send({ error: 'This event has resolved — betting is closed.' });
    }

    const client = await app.db.connect();
    try {
      await client.query('BEGIN');

      const agentResult = await client.query(
        'SELECT id, name, country_code, org, model, gns_balance FROM agents WHERE id = $1 FOR UPDATE',
        [agentId]
      );
      const agent = agentResult.rows[0];

      if (agent.gns_balance < gns_wagered) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: 'Insufficient GNS balance' });
      }

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

      const quantities: number[] = parseNumericArray(market.quantities);
      const b: number = Number(market.b_parameter);
      const { shares, newQuantities, pricePerShare } = lmsrBuy(quantities, b, outcome_index, gns_wagered);

      await client.query(
        'UPDATE agents SET gns_balance = gns_balance - $1 WHERE id = $2',
        [gns_wagered, agentId]
      );

      await client.query(
        'UPDATE markets SET quantities = $1, updated_at = NOW() WHERE id = $2',
        [newQuantities, market_id]
      );

      const betResult = await client.query<{ id: string; created_at: string }>(
        `INSERT INTO bets (agent_id, market_id, outcome_index, gns_wagered, shares_received, price_per_share, confidence, reasoning)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, created_at`,
        [agentId, market_id, outcome_index, gns_wagered, shares, pricePerShare, confidence, reasoning]
      );

      await client.query('COMMIT');

      let eventTitle: string | null = null;
      if (market.event_id) {
        const { rows: [evt] } = await client.query(
          'SELECT title FROM events WHERE id = $1', [market.event_id]
        );
        if (evt) eventTitle = evt.title;
      }

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
          question: eventTitle ?? market.question,
          polymarket_url: market.polymarket_url,
          category: market.category,
          outcomes: market.outcomes,
          closes_at: market.closes_at,
        },
      };

      const newProbs = lmsrProbs(newQuantities, b);
      broadcastBet(bet);
      broadcastMarketUpdate(market_id, newProbs);

      // Record price history snapshot
      recordMarketSnapshot(app.db, market_id, newQuantities, b, 'bet').catch(() => {});

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
  }

  // ── Event outcome bet (native multi-outcome LMSR) ────────────────────
  async function handleEventBet(
    app: FastifyInstance, _req: any, reply: any,
    agentId: string, eventId: string, outcomeLabel: string,
    gns_wagered: number, confidence: number, reasoning: string,
  ) {
    const client = await app.db.connect();
    let released = false;
    try {
      await client.query('BEGIN');

      // Lock agent
      const agentResult = await client.query(
        'SELECT id, name, country_code, org, model, gns_balance FROM agents WHERE id = $1 FOR UPDATE',
        [agentId]
      );
      const agent = agentResult.rows[0];
      if (agent.gns_balance < gns_wagered) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: 'Insufficient GNS balance' });
      }

      // Lock event row
      const { rows: [event] } = await client.query(
        'SELECT * FROM events WHERE id = $1 AND resolved = false FOR UPDATE',
        [eventId]
      );
      if (!event) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: 'Event not found or already resolved' });
      }

      // Fetch ALL child markets (including resolved) to match quantities vector indices
      const { rows: children } = await client.query(
        `SELECT m.id, m.outcome_label, m.initial_probs, m.resolved, m.closes_at FROM markets m
         WHERE m.event_id = $1
         ORDER BY m.polymarket_id ASC`,
        [eventId]
      );

      const outcomeLabels = children.map(c => c.outcome_label as string);
      const outcomeIndex = outcomeLabels.findIndex(
        (label) => label.toLowerCase() === outcomeLabel.toLowerCase()
      );

      if (outcomeIndex === -1) {
        await client.query('ROLLBACK');
        return reply.status(400).send({
          error: `No outcome matching "${outcomeLabel}" found. Available: ${outcomeLabels.join(', ')}`,
        });
      }

      // Reject bets on resolved/passed outcomes
      const targetChild = children[outcomeIndex];
      const isPassed = targetChild.resolved || (targetChild.closes_at && new Date(targetChild.closes_at) < new Date());
      if (isPassed) {
        await client.query('ROLLBACK');
        return reply.status(409).send({
          error: `Outcome "${outcomeLabels[outcomeIndex]}" has passed — betting is closed for this outcome.`,
        });
      }

      // Independent/sports_props events: route to binary LMSR on child market
      if (event.event_type === 'independent' || event.event_type === 'sports_props') {
        await client.query('ROLLBACK');
        released = true;
        client.release();
        return handleBinaryBet(app, _req, reply, agentId, children[outcomeIndex].id, 0, gns_wagered, confidence, reasoning);
      }

      // Verify event has quantities initialized
      const quantities = parseNumericArray(event.quantities);
      if (quantities.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: 'Event LMSR not initialized.' });
      }

      // Market diversity rule: max 3 bets per outcome per agent per 24hrs
      const { rows: [recentCount] } = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM bets b
         JOIN markets m ON m.id = b.market_id
         WHERE b.agent_id = $1 AND m.event_id = $2 AND b.outcome_label = $3
           AND b.created_at > NOW() - INTERVAL '24 hours'`,
        [agentId, eventId, outcomeLabels[outcomeIndex]]
      );
      if (recentCount.cnt >= 3) {
        await client.query('ROLLBACK');
        return reply.status(429).send({
          error: `Rate limited: max 3 bets per outcome per 24 hours. You have ${recentCount.cnt} recent bets on "${outcomeLabels[outcomeIndex]}".`,
        });
      }

      // Check if this agent is new to this event
      const { rows: existingActivity } = await client.query(
        `SELECT 1 FROM event_agent_activity WHERE event_id = $1 AND agent_id = $2`,
        [eventId, agentId]
      );
      const isNewAgent = existingActivity.length === 0;
      let activeAgentCount = Number(event.active_agent_count);
      if (isNewAgent) {
        activeAgentCount++;
      }

      // Dynamic b
      const baseB = Number(event.base_b);
      const dynamicB = computeDynamicB(baseB, activeAgentCount);

      // Prices before
      const priceBefore = computeMultiOutcomePrice(quantities, dynamicB);
      const robullPriceBefore = priceBefore[outcomeIndex];

      // Polymarket probability for calibration
      const polymarketPrice = children[outcomeIndex].initial_probs
        ? Number(children[outcomeIndex].initial_probs[0])
        : null;

      // Calculate shares
      const shares = computeMultiOutcomeSharesForCost(quantities, outcomeIndex, gns_wagered, dynamicB);
      const pricePerShare = shares > 0 ? gns_wagered / shares : 0;

      // New quantities
      const newQuantities = quantities.map((q, i) => (i === outcomeIndex ? q + shares : q));

      // Prices after
      const priceAfter = computeMultiOutcomePrice(newQuantities, dynamicB);
      const robullPriceAfter = priceAfter[outcomeIndex];
      const priceImpact = robullPriceAfter - robullPriceBefore;

      // Verify sum = 1.0
      const probSum = priceAfter.reduce((a, v) => a + v, 0);
      if (Math.abs(probSum - 1.0) > 0.0001) {
        await client.query('ROLLBACK');
        throw new Error(`LMSR probabilities do not sum to 1.0: ${probSum}`);
      }

      // Deduct GNS
      await client.query(
        'UPDATE agents SET gns_balance = gns_balance - $1 WHERE id = $2',
        [gns_wagered, agentId]
      );

      // Update event
      await client.query(
        `UPDATE events SET quantities = $1, lmsr_b = $2, active_agent_count = $3, updated_at = NOW() WHERE id = $4`,
        [newQuantities, dynamicB, activeAgentCount, eventId]
      );

      // Record agent activity
      if (isNewAgent) {
        await client.query(
          `INSERT INTO event_agent_activity (event_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [eventId, agentId]
        );
      }

      // Insert bet (linked to child market for FK)
      const { parent_bet_id, reply_type, reply_to_agent } = _req.body as PlaceBetBody;
      const betResult = await client.query<{ id: string; created_at: string }>(
        `INSERT INTO bets (agent_id, market_id, outcome_index, gns_wagered, shares_received, price_per_share,
                           confidence, reasoning, outcome_label, polymarket_price_at_bet, robull_price_at_bet, price_impact,
                           parent_bet_id, reply_type, reply_to_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id, created_at`,
        [agentId, children[outcomeIndex].id, outcomeIndex, gns_wagered, shares, pricePerShare,
         confidence, reasoning, outcomeLabels[outcomeIndex], polymarketPrice, robullPriceBefore, priceImpact,
         parent_bet_id ?? null, reply_type ?? null, reply_to_agent ?? null]
      );

      await client.query('COMMIT');

      // SSE broadcast
      const bet: BetWithContext = {
        id: betResult.rows[0].id,
        agent_id: agentId,
        market_id: children[outcomeIndex].id,
        outcome_index: outcomeIndex,
        gns_wagered,
        shares_received: shares,
        price_per_share: pricePerShare,
        confidence,
        reasoning,
        created_at: betResult.rows[0].created_at,
        outcome_name: outcomeLabels[outcomeIndex],
        event_id: eventId,
        event_title: event.title,
        parent_bet_id: parent_bet_id ?? null,
        reply_type: reply_type ?? null,
        reply_to_agent: reply_to_agent ?? null,
        agent: {
          name: agent.name,
          country_code: agent.country_code,
          org: agent.org,
          model: agent.model,
        },
        market: {
          question: event.title,
          polymarket_url: event.polymarket_url,
          category: event.category,
          outcomes: outcomeLabels,
          closes_at: event.closes_at,
        },
      };

      broadcastBet(bet);
      broadcastEventUpdate(eventId, priceAfter, outcomeLabels);

      // Record price history snapshot
      recordEventSnapshot(app.db, eventId, priceAfter, 'bet').catch(() => {});

      return reply.status(201).send({
        bet_id: betResult.rows[0].id,
        event_id: eventId,
        outcome_label: outcomeLabels[outcomeIndex],
        shares_received: shares,
        price_per_share: pricePerShare,
        robull_price_before: robullPriceBefore,
        robull_price_after: robullPriceAfter,
        price_impact: priceImpact,
        polymarket_price: polymarketPrice,
        new_probs: priceAfter,
        outcomes: outcomeLabels,
        active_agents: activeAgentCount,
        lmsr_b: dynamicB,
        gns_remaining: Number(agent.gns_balance) - gns_wagered,
      });
    } catch (err) {
      if (!released) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (!released) client.release();
    }
  }

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
         m.question, m.polymarket_url, m.category, m.outcomes, m.closes_at,
         m.resolved AS market_resolved, m.winning_outcome, m.outcome_label,
         m.event_id,
         e.title AS event_title, e.polymarket_url AS event_polymarket_url
       FROM bets b
       JOIN agents a ON a.id = b.agent_id
       JOIN markets m ON m.id = b.market_id
       LEFT JOIN events e ON e.id = m.event_id
       ${where}
       ORDER BY b.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return reply.send(rows);
  });
}
