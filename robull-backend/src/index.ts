import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import cron from 'node-cron';

import postgresPlugin from './plugins/postgres.js';
import redisPlugin from './plugins/redis.js';

import agentRoutes from './routes/agents.js';
import marketRoutes from './routes/markets.js';
import eventRoutes from './routes/events.js';
import betRoutes from './routes/bets.js';
import streamRoutes from './routes/stream.js';

import { syncMarkets } from './cron/syncMarkets.js';
import { syncTier } from './cron/syncMarketsTiered.js';
import { runMigrations } from './db/migrate.js';

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty' }
      : undefined,
  },
});

async function start() {
  // Run DB migrations before anything else
  await runMigrations();

  // Plugins
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? '*',
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    // Tighter limit for bet placement
    keyGenerator: (req) => req.headers.authorization ?? req.ip,
  });

  await app.register(postgresPlugin);
  await app.register(redisPlugin);

  // Routes
  await app.register(agentRoutes,  { prefix: '/v1/agents' });
  await app.register(marketRoutes, { prefix: '/v1/markets' });
  await app.register(eventRoutes,  { prefix: '/v1/events' });
  await app.register(betRoutes,    { prefix: '/v1/bets' });
  await app.register(streamRoutes, { prefix: '/v1/stream' });
  // Health check
  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }));

  // Temporary admin endpoint — remove after payout test
  app.post('/v1/admin/simulate-payout', async (req, reply) => {
    if (req.headers['x-admin-key'] !== 'robull-reset-2026') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { processMarketPayouts } = await import('./services/payouts.js');
    const TESTER_ID = '032920f8-1d42-4e23-9720-ca117214cb12';

    // Get balance before
    const { rows: [agentBefore] } = await app.db.query(
      'SELECT gns_balance FROM agents WHERE id = $1', [TESTER_ID]
    );
    const balanceBefore = Number(agentBefore.gns_balance);

    // Create fake market
    const { rows: [fakeMarket] } = await app.db.query(
      `INSERT INTO markets (polymarket_id, question, category, volume, b_parameter, outcomes, quantities, initial_probs, closes_at, resolved, winning_outcome)
       VALUES ('test-payout-sim', 'PAYOUT TEST — Will this test pass?', 'POLITICS', 1000000, 200,
               ARRAY['Yes','No'], ARRAY[200,200], ARRAY[0.5,0.5], NOW() + INTERVAL '1 hour', true, 0)
       RETURNING id`
    );

    // Create winning bet: 400 GNS, 600 shares on outcome 0 (Yes — the winner)
    const { rows: [winBet] } = await app.db.query(
      `INSERT INTO bets (agent_id, market_id, outcome_index, gns_wagered, shares_received, price_per_share, confidence, reasoning)
       VALUES ($1, $2, 0, 400, 600, 0.6667, 80, 'Test winning bet')
       RETURNING id`,
      [TESTER_ID, fakeMarket.id]
    );

    // Create losing bet: 200 GNS, 300 shares on outcome 1 (No — the loser)
    const { rows: [loseBet] } = await app.db.query(
      `INSERT INTO bets (agent_id, market_id, outcome_index, gns_wagered, shares_received, price_per_share, confidence, reasoning)
       VALUES ($1, $2, 1, 200, 300, 0.6667, 40, 'Test losing bet')
       RETURNING id`,
      [TESTER_ID, fakeMarket.id]
    );

    // Run payout
    const result = await processMarketPayouts(app.db, fakeMarket.id, 0);

    // Get balance after
    const { rows: [agentAfter] } = await app.db.query(
      'SELECT gns_balance FROM agents WHERE id = $1', [TESTER_ID]
    );
    const balanceAfter = Number(agentAfter.gns_balance);

    // Get settled bets
    const { rows: [winBetAfter] } = await app.db.query(
      'SELECT settled, gns_returned FROM bets WHERE id = $1', [winBet.id]
    );
    const { rows: [loseBetAfter] } = await app.db.query(
      'SELECT settled, gns_returned FROM bets WHERE id = $1', [loseBet.id]
    );

    // Get agent stats from leaderboard query
    const { rows: [stats] } = await app.db.query(`
      SELECT
        COUNT(b.id) FILTER (WHERE b.settled AND b.gns_returned > b.gns_wagered)::int AS wins,
        COUNT(b.id) FILTER (WHERE b.settled AND b.gns_returned <= b.gns_wagered)::int AS losses
      FROM bets b WHERE b.agent_id = $1
    `, [TESTER_ID]);
    const wins = stats.wins;
    const losses = stats.losses;
    const winRate = wins + losses > 0 ? (wins / (wins + losses) * 100) : 0;
    const roi = ((balanceAfter - 10000) / 10000 * 100);

    // Cleanup: delete fake bets and market
    await app.db.query('DELETE FROM bets WHERE market_id = $1', [fakeMarket.id]);
    await app.db.query('DELETE FROM markets WHERE id = $1', [fakeMarket.id]);

    // Reverse the balance change from the winning payout (cleanup)
    await app.db.query(
      'UPDATE agents SET gns_balance = gns_balance - 600 WHERE id = $1', [TESTER_ID]
    );

    return {
      test: 'PAYOUT SIMULATION',
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      balance_change: balanceAfter - balanceBefore,
      expected_change: 600,
      winning_bet: { id: winBet.id, settled: winBetAfter.settled, gns_returned: Number(winBetAfter.gns_returned) },
      losing_bet: { id: loseBet.id, settled: loseBetAfter.settled, gns_returned: Number(loseBetAfter.gns_returned) },
      agent_stats: { wins, losses, win_rate: `${winRate.toFixed(1)}%`, roi: `${roi.toFixed(1)}%` },
      payout_result: result,
      cleanup: 'Fake market, bets deleted. Balance reversed.',
    };
  });

  // Start server
  const port = Number(process.env.PORT ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Robull backend listening on port ${port}`);

  // ── Market discovery sync (hourly) ─────────────────────────────────────
  // Fetches new markets from Polymarket, reclassifies all, enforces close buffer
  syncMarkets(app.db, app.redis).catch((err) => console.error('Initial market sync failed:', err));
  cron.schedule('0 * * * *', () =>
    syncMarkets(app.db, app.redis).catch((err) => console.error('Cron market sync failed:', err))
  );

  // ── Tiered integrity sync ──────────────────────────────────────────────
  // Urgent: markets closing within 24h — check every 2 minutes
  cron.schedule('*/2 * * * *', () =>
    syncTier(app.db, app.redis, 'urgent').catch((err) => console.error('Urgent tier sync failed:', err))
  );

  // Soon: markets closing within 7 days — check every 15 minutes
  cron.schedule('*/15 * * * *', () =>
    syncTier(app.db, app.redis, 'soon').catch((err) => console.error('Soon tier sync failed:', err))
  );

  // Distant: all other markets — check every 60 minutes
  cron.schedule('30 * * * *', () =>
    syncTier(app.db, app.redis, 'distant').catch((err) => console.error('Distant tier sync failed:', err))
  );
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
