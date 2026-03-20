import type { Pool } from 'pg';
import { broadcastMarketResolved } from './sse.js';
import { checkEventResolution } from './marketIntegrity.js';

const BATCH_SIZE = 100;

export interface PayoutResult {
  marketId: string;
  marketTitle: string;
  winningOutcome: string;
  totalWinners: number;
  totalLosers: number;
  totalPaidOut: number;
  topPayouts: { agent_name: string; country_code: string; gns_won: number }[];
}

export async function processMarketPayouts(
  db: Pool,
  marketId: string,
  winningOutcomeIndex: number,
): Promise<PayoutResult | null> {
  // Fetch market info
  const { rows: [market] } = await db.query(
    'SELECT id, question, outcomes, event_id FROM markets WHERE id = $1',
    [marketId]
  );
  if (!market) return null;

  const outcomes: string[] = Array.isArray(market.outcomes) ? market.outcomes : [];
  const winningOutcomeName = outcomes[winningOutcomeIndex] ?? `Outcome ${winningOutcomeIndex}`;

  // Fetch all unsettled bets on this market
  const { rows: bets } = await db.query(
    `SELECT id, agent_id, outcome_index, gns_wagered, shares_received
     FROM bets WHERE market_id = $1 AND settled = false`,
    [marketId]
  );

  if (bets.length === 0) {
    console.log(`[payout] "${market.question?.slice(0, 50)}" — no unsettled bets`);
    return null;
  }

  let totalWinners = 0;
  let totalLosers = 0;
  let totalPaidOut = 0;
  const winnerPayouts: { agent_id: string; gns_won: number }[] = [];

  // Process in batches
  for (let i = 0; i < bets.length; i += BATCH_SIZE) {
    const batch = bets.slice(i, i + BATCH_SIZE);

    for (const bet of batch) {
      const isWinner = bet.outcome_index === winningOutcomeIndex;

      if (isWinner) {
        // Winner: payout = shares_received (1 GNS per share)
        const payout = Number(bet.shares_received);

        await db.query(
          'UPDATE agents SET gns_balance = gns_balance + $1 WHERE id = $2',
          [payout, bet.agent_id]
        );
        await db.query(
          'UPDATE bets SET settled = true, gns_returned = $1 WHERE id = $2',
          [payout, bet.id]
        );

        totalWinners++;
        totalPaidOut += payout;
        winnerPayouts.push({ agent_id: bet.agent_id, gns_won: payout });
      } else {
        // Loser: no payout
        await db.query(
          'UPDATE bets SET settled = true, gns_returned = 0 WHERE id = $1',
          [bet.id]
        );
        totalLosers++;
      }
    }
  }

  // Fetch top 5 winner names for broadcast
  const topPayouts = [];
  const sortedWinners = winnerPayouts.sort((a, b) => b.gns_won - a.gns_won).slice(0, 5);
  for (const w of sortedWinners) {
    const { rows: [agent] } = await db.query(
      'SELECT name, country_code FROM agents WHERE id = $1',
      [w.agent_id]
    );
    if (agent) {
      topPayouts.push({
        agent_name: agent.name,
        country_code: agent.country_code,
        gns_won: Math.round(w.gns_won * 100) / 100,
      });
    }
  }

  // Log
  const topStr = topPayouts.map(t => `${t.agent_name} +${t.gns_won} GNS`).join(', ');
  console.log(
    `[payout] "${market.question?.slice(0, 50)}" resolved — ${totalWinners} winners paid out, ${totalLosers} losers settled.${topStr ? ` Top: ${topStr}` : ''}`
  );

  // Broadcast SSE
  broadcastMarketResolved({
    market_title: market.question,
    winning_outcome: winningOutcomeName,
    total_winners: totalWinners,
    total_losers: totalLosers,
    top_payouts: topPayouts,
  });

  // If child market, check parent event resolution
  if (market.event_id) {
    await checkEventResolution(db, market.event_id);
  }

  return {
    marketId,
    marketTitle: market.question,
    winningOutcome: winningOutcomeName,
    totalWinners,
    totalLosers,
    totalPaidOut,
    topPayouts,
  };
}
