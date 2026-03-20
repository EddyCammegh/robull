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
  app.get('/v1/admin/debug-alignment', async (req, reply) => {
    if (req.headers['x-admin-key'] !== 'robull-reset-2026') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { parseNumericArray, computeMultiOutcomePrice, computeDynamicB } = await import('./services/lmsr.js');

    // Find date-based events
    const { rows: events } = await app.db.query(`
      SELECT id, title, quantities, lmsr_b, base_b, active_agent_count, event_type
      FROM events
      WHERE (title ILIKE '%Kraken%' OR title ILIKE '%Ukraine election%' OR title ILIKE '%by Q%' OR title ILIKE '%by March%' OR title ILIKE '%by June%')
        AND resolved = false
      LIMIT 5
    `);

    const results = [];
    for (const evt of events) {
      const { rows: children } = await app.db.query(
        `SELECT m.polymarket_id, m.id, m.outcome_label, m.quantities AS child_quantities, m.b_parameter, m.initial_probs
         FROM markets m WHERE m.event_id = $1
         ORDER BY m.polymarket_id ASC`,
        [evt.id]
      );

      const eventQ = parseNumericArray(evt.quantities);
      const b = computeDynamicB(Number(evt.base_b ?? 200), Math.max(Number(evt.active_agent_count ?? 0), 1));

      let eventProbs: number[] | null = null;
      if (eventQ.length > 0) {
        try { eventProbs = computeMultiOutcomePrice(eventQ, b); } catch {}
      }

      const childDetails = children.map((c: any, idx: number) => {
        const cProbs = parseNumericArray(c.initial_probs);
        return {
          index: idx,
          polymarket_id: c.polymarket_id,
          label: c.outcome_label,
          polymarket_yes_prob: cProbs[0] ?? null,
          event_lmsr_prob: eventProbs ? eventProbs[idx] : null,
          match: eventProbs && cProbs[0] != null ? Math.abs(eventProbs[idx] - cProbs[0]) < 0.05 : null,
        };
      });

      results.push({
        event_id: evt.id,
        title: evt.title,
        event_type: evt.event_type,
        quantities_length: eventQ.length,
        children_count: children.length,
        length_match: eventQ.length === children.length,
        b,
        children: childDetails,
      });
    }

    // Also count how many events need re-init
    const { rows: [reinitCount] } = await app.db.query(`
      SELECT COUNT(*)::int AS count FROM events
      WHERE active_agent_count = 0 AND resolved = false AND event_type = 'mutually_exclusive'
    `);

    return { events: results, events_needing_reinit: reinitCount.count };
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
