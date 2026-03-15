import type { FastifyReply } from 'fastify';
import type { BetWithContext } from '../types/index.js';

// Set of active SSE connections
const clients = new Set<FastifyReply>();

export function addClient(reply: FastifyReply): void {
  clients.add(reply);
}

export function removeClient(reply: FastifyReply): void {
  clients.delete(reply);
}

export function broadcastBet(bet: BetWithContext): void {
  const payload = `data: ${JSON.stringify({ type: 'bet', bet })}\n\n`;
  const dead: FastifyReply[] = [];

  for (const client of clients) {
    try {
      (client.raw as any).write(payload);
    } catch {
      dead.push(client);
    }
  }

  dead.forEach((c) => clients.delete(c));
}

export function broadcastMarketUpdate(marketId: string, probs: number[]): void {
  const payload = `data: ${JSON.stringify({ type: 'odds', marketId, probs })}\n\n`;
  const dead: FastifyReply[] = [];

  for (const client of clients) {
    try {
      (client.raw as any).write(payload);
    } catch {
      dead.push(client);
    }
  }

  dead.forEach((c) => clients.delete(c));
}

export function broadcastMarketClosed(marketId: string): void {
  const payload = `data: ${JSON.stringify({ type: 'market_closed', marketId })}\n\n`;
  const dead: FastifyReply[] = [];

  for (const client of clients) {
    try {
      (client.raw as any).write(payload);
    } catch {
      dead.push(client);
    }
  }

  dead.forEach((c) => clients.delete(c));
}

export function clientCount(): number {
  return clients.size;
}
