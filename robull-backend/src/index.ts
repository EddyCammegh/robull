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

  // Temporary debug endpoint — remove after diagnosis
  app.get('/v1/admin/market-status', async (req, reply) => {
    if (req.headers['x-admin-key'] !== 'robull-reset-2026') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { rows: marketCounts } = await app.db.query(`
      SELECT category, resolved, COUNT(*)::int AS count
      FROM markets
      WHERE category IN ('POLITICS','CRYPTO','MACRO','AI/TECH')
        AND closes_at > NOW()
        AND winning_outcome IS NULL
      GROUP BY category, resolved
      ORDER BY category, resolved
    `);

    const { rows: eventCounts } = await app.db.query(`
      SELECT category, resolved, COUNT(*)::int AS count
      FROM events
      WHERE category IN ('POLITICS','CRYPTO','MACRO','AI/TECH')
        AND winning_outcome_label IS NULL
      GROUP BY category, resolved
      ORDER BY category, resolved
    `);

    // Also check what's resolving them — recent resolved markets
    const { rows: recentlyResolved } = await app.db.query(`
      SELECT id, question, category, resolved, winning_outcome, event_id, closes_at, updated_at
      FROM markets
      WHERE category IN ('POLITICS','CRYPTO','MACRO','AI/TECH')
        AND resolved = true
        AND winning_outcome IS NULL
        AND closes_at > NOW()
      ORDER BY updated_at DESC
      LIMIT 10
    `);

    // Check migrate.ts damage — markets resolved with winning_outcome=-1
    const { rows: [sentinel] } = await app.db.query(`
      SELECT COUNT(*)::int AS count FROM markets WHERE winning_outcome = -1
    `);

    return {
      markets_by_category_resolved: marketCounts,
      events_by_category_resolved: eventCounts,
      recently_resolved_samples: recentlyResolved,
      markets_with_sentinel_winning_outcome: sentinel.count,
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
