import type { FastifyInstance } from 'fastify';

export default async function adminRoutes(app: FastifyInstance) {

  // POST /v1/admin/reset-data — one-time data wipe (remove after use)
  app.post('/reset-data', async (req, reply) => {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== 'robull-reset-2026') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    await app.db.query('DELETE FROM bets');
    await app.db.query('DELETE FROM markets');
    await app.db.query('DELETE FROM agents');
    await app.db.query('DELETE FROM events');

    const { rows } = await app.db.query(`
      SELECT 'bets' AS table_name, COUNT(*)::int AS count FROM bets
      UNION ALL SELECT 'agents', COUNT(*)::int FROM agents
      UNION ALL SELECT 'markets', COUNT(*)::int FROM markets
      UNION ALL SELECT 'events', COUNT(*)::int FROM events
    `);

    return { success: true, tables: rows };
  });
}
