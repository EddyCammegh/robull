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

  // Temporary debug — remove after use
  app.get('/v1/admin/check-ukraine', async (req, reply) => {
    if (req.headers['x-admin-key'] !== 'robull-reset-2026') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { rows: events } = await app.db.query(`
      SELECT id, title, resolved, event_type, category
      FROM events WHERE title ILIKE '%Ukraine election held%'
    `);

    const children = [];
    for (const evt of events) {
      const { rows } = await app.db.query(`
        SELECT outcome_label, resolved, closes_at, winning_outcome, event_id, category,
               polymarket_id, question
        FROM markets WHERE event_id = $1
        ORDER BY polymarket_id ASC
      `, [evt.id]);
      children.push({ event: evt, markets: rows });
    }

    // Also check server time
    const { rows: [serverTime] } = await app.db.query(`SELECT NOW() AS server_now`);

    return { server_now: serverTime.server_now, events: children };
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
