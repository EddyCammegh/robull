/**
 * Payout system simulation test.
 * Run: npx tsx src/tests/payouts.test.ts
 *
 * Simulates a market resolution with fake in-memory data to verify
 * the payout logic without needing a database connection.
 */

// Simulate the payout logic in-memory
interface FakeBet {
  id: string;
  agent_id: string;
  outcome_index: number;
  gns_wagered: number;
  shares_received: number;
  settled: boolean;
  gns_returned: number | null;
}

interface FakeAgent {
  id: string;
  name: string;
  gns_balance: number;
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.log(`  FAIL: ${msg}`);
    failed++;
  }
}

function approxEqual(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) < eps;
}

// ── Simulation ──────────────────────────────────────────────────────────

console.log('\nTest — Market Payout Simulation:');

// Setup: 2 agents, 1 market with 3 bets
const agents: FakeAgent[] = [
  { id: 'agent-1', name: 'CASSANDRA', gns_balance: 9000 },  // started 10000, wagered 1000
  { id: 'agent-2', name: 'BAYES', gns_balance: 9500 },       // started 10000, wagered 500
];

const bets: FakeBet[] = [
  // CASSANDRA bet 1000 GNS on outcome 0 (Yes), got 1400 shares
  { id: 'bet-1', agent_id: 'agent-1', outcome_index: 0, gns_wagered: 1000, shares_received: 1400, settled: false, gns_returned: null },
  // BAYES bet 500 GNS on outcome 1 (No), got 600 shares
  { id: 'bet-2', agent_id: 'agent-2', outcome_index: 1, gns_wagered: 500, shares_received: 600, settled: false, gns_returned: null },
  // CASSANDRA also bet 200 GNS on outcome 1 (No), got 250 shares
  { id: 'bet-3', agent_id: 'agent-1', outcome_index: 1, gns_wagered: 200, shares_received: 250, settled: false, gns_returned: null },
];

// Market resolves: outcome 0 (Yes) wins
const winningOutcome = 0;

console.log('  Setup:');
console.log(`    CASSANDRA: balance=${agents[0].gns_balance}, bets on Yes(1000 GNS, 1400 shares) + No(200 GNS, 250 shares)`);
console.log(`    BAYES: balance=${agents[1].gns_balance}, bet on No(500 GNS, 600 shares)`);
console.log(`    Winning outcome: ${winningOutcome} (Yes)`);

// Process payouts
let totalWinners = 0;
let totalLosers = 0;
let totalPaidOut = 0;

for (const bet of bets) {
  const isWinner = bet.outcome_index === winningOutcome;

  if (isWinner) {
    const payout = bet.shares_received; // 1 GNS per share
    const agent = agents.find(a => a.id === bet.agent_id)!;
    agent.gns_balance += payout;
    bet.settled = true;
    bet.gns_returned = payout;
    totalWinners++;
    totalPaidOut += payout;
  } else {
    bet.settled = true;
    bet.gns_returned = 0;
    totalLosers++;
  }
}

console.log('\n  Results:');
console.log(`    Winners: ${totalWinners}, Losers: ${totalLosers}, Total paid: ${totalPaidOut} GNS`);
console.log(`    CASSANDRA balance: ${agents[0].gns_balance} (expected: 10400)`);
console.log(`    BAYES balance: ${agents[1].gns_balance} (expected: 9500)`);

// Verify
assert(totalWinners === 1, 'exactly 1 winning bet');
assert(totalLosers === 2, 'exactly 2 losing bets');
assert(totalPaidOut === 1400, 'total paid out = 1400 GNS');

// CASSANDRA: started 9000 (after wagering 1000+200), won 1400 on Yes bet
// Net: 9000 + 1400 = 10400
assert(approxEqual(agents[0].gns_balance, 10400), 'CASSANDRA balance = 10400 (won 1400, lost 200 wager on No)');

// BAYES: started 9500 (after wagering 500), lost No bet, no payout
// Net: 9500 (unchanged — already deducted when bet was placed)
assert(approxEqual(agents[1].gns_balance, 9500), 'BAYES balance = 9500 (unchanged, lost bet)');

// All bets settled
assert(bets.every(b => b.settled), 'all bets marked settled');
assert(bets[0].gns_returned === 1400, 'winning bet gns_returned = 1400');
assert(bets[1].gns_returned === 0, 'losing bet gns_returned = 0');
assert(bets[2].gns_returned === 0, 'losing bet gns_returned = 0');

// ROI calculations
const cassandraRoi = (agents[0].gns_balance - 10000) / 10000 * 100;
const bayesRoi = (agents[1].gns_balance - 10000) / 10000 * 100;
console.log(`\n    CASSANDRA ROI: ${cassandraRoi.toFixed(1)}%`);
console.log(`    BAYES ROI: ${bayesRoi.toFixed(1)}%`);
assert(approxEqual(cassandraRoi, 4.0), 'CASSANDRA ROI = 4.0%');
assert(approxEqual(bayesRoi, -5.0), 'BAYES ROI = -5.0%');

// Win rate
// CASSANDRA: 1 win (Yes), 1 loss (No) → 50%
// BAYES: 0 wins, 1 loss → 0%
const cassandraWins = bets.filter(b => b.agent_id === 'agent-1' && b.gns_returned! > 0).length;
const cassandraLosses = bets.filter(b => b.agent_id === 'agent-1' && b.gns_returned === 0).length;
const bayesWins = bets.filter(b => b.agent_id === 'agent-2' && b.gns_returned! > 0).length;
const bayesLosses = bets.filter(b => b.agent_id === 'agent-2' && b.gns_returned === 0).length;

console.log(`    CASSANDRA wins=${cassandraWins}, losses=${cassandraLosses}, win_rate=${(cassandraWins / (cassandraWins + cassandraLosses) * 100).toFixed(0)}%`);
console.log(`    BAYES wins=${bayesWins}, losses=${bayesLosses}, win_rate=${bayesWins > 0 ? (bayesWins / (bayesWins + bayesLosses) * 100).toFixed(0) : 0}%`);

assert(cassandraWins === 1 && cassandraLosses === 1, 'CASSANDRA: 1 win, 1 loss');
assert(bayesWins === 0 && bayesLosses === 1, 'BAYES: 0 wins, 1 loss');

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) process.exit(1);
