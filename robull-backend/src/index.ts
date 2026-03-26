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
import priceHistoryRoutes from './routes/priceHistory.js';
import adminRoutes from './routes/admin.js';

import { syncMarkets } from './cron/syncMarkets.js';
import { syncTier } from './cron/syncMarketsTiered.js';
import { runMigrations } from './db/migrate.js';
import { refreshNewsfeed, getRelevantArticles } from './services/newsfeed.js';
import { refreshPrices, getPrices } from './services/prices.js';

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty' }
      : undefined,
  },
});

async function start() {
  console.log('[boot] Starting Robull backend...');
  console.log('[boot] Node', process.version, '| fastify 5.x | env:', process.env.NODE_ENV ?? 'development');

  // Run DB migrations before anything else
  console.log('[boot] Running migrations...');
  await runMigrations();
  console.log('[boot] Migrations complete.');

  // Plugins
  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : '*';
  console.log('[boot] Registering CORS (origin:', Array.isArray(corsOrigin) ? corsOrigin.join(', ') : corsOrigin, ')');
  await app.register(cors, {
    origin: corsOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  console.log('[boot] Registering rate-limit...');
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.headers.authorization ?? req.ip,
  });

  console.log('[boot] Connecting Postgres...');
  await app.register(postgresPlugin);
  console.log('[boot] Connecting Redis...');
  await app.register(redisPlugin);
  console.log('[boot] Plugins registered.');

  // Routes
  await app.register(agentRoutes,  { prefix: '/v1/agents' });
  await app.register(marketRoutes, { prefix: '/v1/markets' });
  await app.register(eventRoutes,  { prefix: '/v1/events' });
  await app.register(betRoutes,    { prefix: '/v1/bets' });
  await app.register(streamRoutes, { prefix: '/v1/stream' });
  await app.register(priceHistoryRoutes, { prefix: '/v1/price-history' });
  await app.register(adminRoutes, { prefix: '/v1/admin' });
  // Health check
  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }));

  // Serve skill.md and heartbeat.md
  app.get('/skill.md', async (_req, reply) => {
    const fs = await import('fs/promises');
    const path = await import('path');
    try {
      const content = await fs.readFile(path.join(process.cwd(), 'skill.md'), 'utf-8');
      return reply.type('text/markdown').send(content);
    } catch {
      return reply.type('text/markdown').send('# Robull Agent Skill\n\nSee https://robull.ai/skill.md');
    }
  });
  app.get('/heartbeat.md', async (_req, reply) => {
    const fs = await import('fs/promises');
    const path = await import('path');
    try {
      const content = await fs.readFile(path.join(process.cwd(), 'heartbeat.md'), 'utf-8');
      return reply.type('text/markdown').send(content);
    } catch {
      return reply.type('text/markdown').send('# Robull Heartbeat\n\nSee https://robull.ai/heartbeat.md');
    }
  });

  // Live prices
  app.get('/v1/prices', async () => getPrices(app.redis));

  // Event news
  app.get<{ Params: { id: string } }>('/v1/events/:id/news', async (req, reply) => {
    const { rows: [evt] } = await app.db.query(
      'SELECT title, category FROM events WHERE id = $1', [req.params.id]
    );
    if (!evt) return reply.status(404).send({ error: 'Event not found' });

    const articles = await getRelevantArticles(app.redis, evt.title, evt.category);
    const prices = ['CRYPTO', 'MACRO'].includes(evt.category)
      ? await getPrices(app.redis) : null;

    return { articles, prices };
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

  // ── Newsfeed & prices ────────────────────────────────────────────────
  refreshNewsfeed(app.redis).catch((err) => console.error('Initial newsfeed refresh failed:', err));
  refreshPrices(app.redis).catch((err) => console.error('Initial price refresh failed:', err));
  cron.schedule('*/15 * * * *', () =>
    refreshNewsfeed(app.redis).catch((err) => console.error('Newsfeed refresh failed:', err))
  );
  cron.schedule('* * * * *', () =>
    refreshPrices(app.redis).catch((err) => console.error('Price refresh failed:', err))
  );
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
