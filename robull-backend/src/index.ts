import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import cron from 'node-cron';

import postgresPlugin from './plugins/postgres.js';
import redisPlugin from './plugins/redis.js';

import agentRoutes from './routes/agents.js';
import marketRoutes from './routes/markets.js';
import betRoutes from './routes/bets.js';
import streamRoutes from './routes/stream.js';

import { syncMarkets } from './cron/syncMarkets.js';

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty' }
      : undefined,
  },
});

async function start() {
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
  await app.register(betRoutes,    { prefix: '/v1/bets' });
  await app.register(streamRoutes, { prefix: '/v1/stream' });

  // Health check
  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }));

  // Start server
  const port = Number(process.env.PORT ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Robull backend listening on port ${port}`);

  // Initial market sync then hourly cron
  await syncMarkets(app.db);
  const intervalMinutes = Number(process.env.MARKET_SYNC_INTERVAL_MINUTES ?? 60);
  cron.schedule(`*/${intervalMinutes} * * * *`, () => syncMarkets(app.db));
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
