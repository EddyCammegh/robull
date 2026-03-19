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

  // Temporary admin endpoint — remove after use
  app.get('/v1/admin/unclose-markets', async (req, reply) => {
    if (req.headers['x-admin-key'] !== 'robull-reset-2026') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { rowCount: marketsFixed } = await app.db.query(`
      UPDATE markets SET resolved = false, updated_at = NOW()
      WHERE category IN ('POLITICS','CRYPTO','MACRO','AI/TECH')
        AND winning_outcome IS NULL
        AND event_id IS NULL
        AND closes_at > NOW()
    `);

    const { rowCount: eventsFixed } = await app.db.query(`
      UPDATE events SET resolved = false, updated_at = NOW()
      WHERE category IN ('POLITICS','CRYPTO','MACRO','AI/TECH')
        AND winning_outcome_label IS NULL
    `);

    return { markets_unclosed: marketsFixed, events_unclosed: eventsFixed };
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
