import fp from 'fastify-plugin';
// fastify-plugin makes the decorated db available across all scopes
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
  }
}

export default fp(async function postgresPlugin(app: FastifyInstance) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Verify connection on startup
  const client = await pool.connect();
  client.release();

  app.decorate('db', pool);

  app.addHook('onClose', async () => {
    await pool.end();
  });
});
