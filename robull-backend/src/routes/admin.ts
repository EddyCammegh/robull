import type { FastifyInstance } from 'fastify';
import { processMarketPayouts } from '../services/payouts.js';
import { calculateMaxBet } from '../config.js';
import { syncMarkets } from '../cron/syncMarkets.js';

const ADMIN_KEY = 'robull-reset-2026';

export default async function adminRoutes(app: FastifyInstance) {
  // POST /v1/admin/test-payout
  app.post('/test-payout', async (req, reply) => {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const marketId = 'a0177cb6-114b-4ea6-b79b-5ccf66aac76e'; // Backpack "by March 31" child market
    const winningOutcome = 0; // Yes

    // Get REGULATOR's state before
    const { rows: [regBefore] } = await app.db.query(
      `SELECT a.id, a.name, a.gns_balance,
              (SELECT COUNT(*)::int FROM bets b WHERE b.agent_id = a.id AND b.settled = true AND b.gns_returned > b.gns_wagered) AS wins
       FROM agents a WHERE a.name = 'REGULATOR'`
    );
    if (!regBefore) {
      return reply.status(404).send({ error: 'REGULATOR agent not found' });
    }
    const balanceBefore = Number(regBefore.gns_balance);
    const winsBefore = regBefore.wins;

    // Get the bet details
    const { rows: [bet] } = await app.db.query(
      `SELECT id, outcome_index, gns_wagered, shares_received, settled, gns_returned
       FROM bets WHERE market_id = $1 AND agent_id = $2 AND settled = false
       LIMIT 1`,
      [marketId, regBefore.id]
    );
    if (!bet) {
      return reply.status(404).send({ error: 'No unsettled bet found for REGULATOR on this market' });
    }

    // Set winning_outcome on the child market
    await app.db.query(
      'UPDATE markets SET winning_outcome = $1, resolved = true, updated_at = NOW() WHERE id = $2',
      [winningOutcome, marketId]
    );

    // Run payouts
    const result = await processMarketPayouts(app.db, marketId, winningOutcome);

    // Get REGULATOR's state after
    const { rows: [regAfter] } = await app.db.query(
      `SELECT a.gns_balance,
              (SELECT COUNT(*)::int FROM bets b WHERE b.agent_id = a.id AND b.settled = true AND b.gns_returned > b.gns_wagered) AS wins
       FROM agents a WHERE a.id = $1`,
      [regBefore.id]
    );
    const balanceAfter = Number(regAfter.gns_balance);
    const winsAfter = regAfter.wins;

    // Get the settled bet
    const { rows: [settledBet] } = await app.db.query(
      'SELECT settled, gns_returned FROM bets WHERE id = $1',
      [bet.id]
    );

    return reply.send({
      market_id: marketId,
      bet_id: bet.id,
      payout_result: result,
      regulator: {
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        balance_change: balanceAfter - balanceBefore,
        shares_received: Number(bet.shares_received),
        gns_returned: settledBet ? Number(settledBet.gns_returned) : null,
        settled: settledBet?.settled,
        wins_before: winsBefore,
        wins_after: winsAfter,
        max_bet_before: calculateMaxBet(balanceBefore),
        max_bet_after: calculateMaxBet(balanceAfter),
      },
    });
  });

  // POST /v1/admin/cleanup-agents — delete duplicate agents, keep one with most bets per name
  app.post('/cleanup-agents', async (req, reply) => {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const dupeIdsQuery = `
      SELECT id, name FROM (
        SELECT a.id, a.name,
               ROW_NUMBER() OVER (
                 PARTITION BY a.name
                 ORDER BY COALESCE(bet_counts.cnt, 0) DESC, a.created_at ASC
               ) AS rn
        FROM agents a
        LEFT JOIN (
          SELECT agent_id, COUNT(*)::int AS cnt FROM bets GROUP BY agent_id
        ) bet_counts ON bet_counts.agent_id = a.id
      ) ranked
      WHERE rn > 1
    `;

    // Delete bets belonging to duplicate agents first
    const { rowCount: betsDeleted } = await app.db.query(`
      DELETE FROM bets WHERE agent_id IN (SELECT id FROM (${dupeIdsQuery}) d)
    `);

    // Delete event_agent_activity for duplicate agents
    const { rowCount: activityDeleted } = await app.db.query(`
      DELETE FROM event_agent_activity WHERE agent_id IN (SELECT id FROM (${dupeIdsQuery}) d)
    `);

    // Then delete the duplicate agents themselves
    const { rows } = await app.db.query(`
      DELETE FROM agents WHERE id IN (SELECT id FROM (${dupeIdsQuery}) d)
      RETURNING id, name
    `);

    return reply.send({
      deleted_agents: rows.length,
      deleted_bets: betsDeleted ?? 0,
      deleted_activity: activityDeleted ?? 0,
      agents: rows.map((r: { id: string; name: string }) => ({ id: r.id, name: r.name })),
    });
  });

  // POST /v1/admin/force-sync — trigger market sync immediately
  app.post('/force-sync', async (req, reply) => {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const start = Date.now();
    try {
      await syncMarkets(app.db, app.redis);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      return reply.send({ ok: true, elapsed_seconds: elapsed });
    } catch (err: any) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      return reply.status(500).send({ ok: false, elapsed_seconds: elapsed, error: err.message });
    }
  });
}
