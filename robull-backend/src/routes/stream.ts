import type { FastifyInstance } from 'fastify';
import { addClient, removeClient, clientCount } from '../services/sse.js';

export default async function streamRoutes(app: FastifyInstance) {

  // GET /v1/stream - SSE endpoint
  app.get('/', async (req, reply) => {
    const raw = reply.raw;

    const allowedOrigin = process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')[0].trim()
      : '*';
    raw.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no', // disable Nginx buffering
      'Access-Control-Allow-Origin': allowedOrigin,
    });

    // Send initial heartbeat so client knows it's connected
    raw.write(`: connected\n\n`);
    raw.write(`data: ${JSON.stringify({ type: 'connected', clients: clientCount() + 1 })}\n\n`);

    addClient(reply);

    // Heartbeat every 25 seconds to keep connection alive through proxies
    const heartbeat = setInterval(() => {
      try {
        raw.write(`: heartbeat\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 25000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      removeClient(reply);
    });

    // Never resolve - keep the connection open
    await new Promise(() => {});
  });
}
