/**
 * Multi-outcome LMSR verification tests.
 * Run: npx tsx src/tests/lmsr-multi.test.ts
 */

import {
  computeDynamicB,
  computeMultiOutcomeCost,
  computeMultiOutcomePrice,
  computeMultiOutcomePurchaseCost,
  computeMultiOutcomeSharesForCost,
  bootstrapEventQuantities,
} from '../services/lmsr.js';

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

function approxEqual(a: number, b: number, eps = 0.001): boolean {
  return Math.abs(a - b) < eps;
}

function arrayApproxEqual(a: number[], b: number[], eps = 0.001): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => approxEqual(v, b[i], eps));
}

// ── Test 1: Equal probabilities ──────────────────────────────────────────
console.log('\nTest 1 — Equal probabilities:');
{
  const q = [200, 200, 200, 200];
  const b = 200;
  const prices = computeMultiOutcomePrice(q, b);
  const sum = prices.reduce((a, v) => a + v, 0);

  console.log(`  quantities: [${q}]`);
  console.log(`  prices: [${prices.map(p => p.toFixed(6))}]`);
  console.log(`  sum: ${sum}`);

  assert(arrayApproxEqual(prices, [0.25, 0.25, 0.25, 0.25]), 'prices = [0.25, 0.25, 0.25, 0.25]');
  assert(approxEqual(sum, 1.0, 0.0001), 'sum = 1.0');
}

// ── Test 2: Polymarket-style initialisation ─────────────────────────────
console.log('\nTest 2 — Polymarket-style initialisation:');
{
  const inputProbs = [0.996, 0.003, 0.0005, 0.0005];
  const b = 200;
  const quantities = bootstrapEventQuantities(inputProbs, b);
  const recovered = computeMultiOutcomePrice(quantities, b);
  const sum = recovered.reduce((a, v) => a + v, 0);

  console.log(`  input probs: [${inputProbs}]`);
  console.log(`  quantities:  [${quantities.map(q => q.toFixed(4))}]`);
  console.log(`  recovered:   [${recovered.map(p => p.toFixed(6))}]`);
  console.log(`  sum: ${sum}`);

  assert(arrayApproxEqual(recovered, inputProbs, 0.01), 'recovered ≈ input probs');
  assert(approxEqual(sum, 1.0, 0.0001), 'sum = 1.0');
}

// ── Test 3: Bet moves price correctly ───────────────────────────────────
console.log('\nTest 3 — Bet moves price correctly:');
{
  const b = 200;
  const q = bootstrapEventQuantities([0.25, 0.25, 0.25, 0.25], b);
  const priceBefore = computeMultiOutcomePrice(q, b);

  console.log(`  prices before: [${priceBefore.map(p => p.toFixed(6))}]`);

  const gns = 500;
  const shares = computeMultiOutcomeSharesForCost(q, 0, gns, b);
  const newQ = q.map((qi, i) => (i === 0 ? qi + shares : qi));
  const priceAfter = computeMultiOutcomePrice(newQ, b);
  const sumAfter = priceAfter.reduce((a, v) => a + v, 0);

  console.log(`  500 GNS on outcome 0 → ${shares.toFixed(4)} shares`);
  console.log(`  prices after:  [${priceAfter.map(p => p.toFixed(6))}]`);
  console.log(`  sum after: ${sumAfter}`);

  assert(priceAfter[0] > priceBefore[0], 'outcome 0 probability increased');
  assert(priceAfter[1] < priceBefore[1], 'outcome 1 probability decreased');
  assert(priceAfter[2] < priceBefore[2], 'outcome 2 probability decreased');
  assert(priceAfter[3] < priceBefore[3], 'outcome 3 probability decreased');
  assert(approxEqual(sumAfter, 1.0, 0.0001), 'sum still = 1.0');

  // Verify cost is approximately 500 GNS
  const cost = computeMultiOutcomePurchaseCost(q, 0, shares, b);
  console.log(`  cost verification: ${cost.toFixed(4)} GNS (target: ${gns})`);
  assert(approxEqual(cost, gns, 0.01), 'cost ≈ 500 GNS');
}

// ── Test 4: Dynamic b scales correctly ──────────────────────────────────
console.log('\nTest 4 — Dynamic b scales correctly:');
{
  const baseB = 200;

  const b1 = computeDynamicB(baseB, 1);
  const b25 = computeDynamicB(baseB, 25);
  const b100 = computeDynamicB(baseB, 100);

  console.log(`  1 agent:   b = ${b1}`);
  console.log(`  25 agents: b = ${b25}`);
  console.log(`  100 agents: b = ${b100}`);

  assert(approxEqual(b1, 200), 'b(1) = 200');
  assert(approxEqual(b25, 1000), 'b(25) = 1000');
  assert(approxEqual(b100, 2000), 'b(100) = 2000');
}

// ── Test 5: Concurrency simulation ──────────────────────────────────────
console.log('\nTest 5 — Concurrency simulation (10 sequential bets):');
{
  const b = 200;
  let q = bootstrapEventQuantities([0.25, 0.25, 0.25, 0.25], b);
  const betsPerOutcome = [0, 0, 0, 0];

  for (let i = 0; i < 10; i++) {
    const outcomeIdx = i % 4; // round-robin across outcomes
    const gns = 100 + Math.random() * 400;
    const shares = computeMultiOutcomeSharesForCost(q, outcomeIdx, gns, b);
    q = q.map((qi, idx) => (idx === outcomeIdx ? qi + shares : qi));
    betsPerOutcome[outcomeIdx]++;
  }

  const finalPrices = computeMultiOutcomePrice(q, b);
  const sum = finalPrices.reduce((a, v) => a + v, 0);
  const noNegativeQ = q.every(qi => qi >= 0);

  console.log(`  final quantities: [${q.map(qi => qi.toFixed(4))}]`);
  console.log(`  final prices:     [${finalPrices.map(p => p.toFixed(6))}]`);
  console.log(`  sum: ${sum}`);
  console.log(`  bets per outcome: [${betsPerOutcome}]`);

  assert(noNegativeQ, 'no negative quantities');
  assert(approxEqual(sum, 1.0, 0.0001), 'sum = 1.0');
  assert(q.every(qi => Number.isFinite(qi)), 'all quantities finite');
  assert(finalPrices.every(p => Number.isFinite(p) && p > 0), 'all prices finite and positive');
}

// ── Test 6: Numerical stability with extreme probabilities ──────────────
console.log('\nTest 6 — Numerical stability with extreme probabilities:');
{
  const b = 200;
  const extremeProbs = [0.999, 0.0003, 0.0003, 0.0004];
  const q = bootstrapEventQuantities(extremeProbs, b);
  const prices = computeMultiOutcomePrice(q, b);
  const sum = prices.reduce((a, v) => a + v, 0);

  console.log(`  input probs: [${extremeProbs}]`);
  console.log(`  quantities:  [${q.map(qi => qi.toFixed(4))}]`);
  console.log(`  prices:      [${prices.map(p => p.toFixed(6))}]`);
  console.log(`  sum: ${sum}`);

  const noNaN = prices.every(p => !isNaN(p));
  const noInf = prices.every(p => Number.isFinite(p));

  assert(noNaN, 'no NaN values');
  assert(noInf, 'no Infinity values');
  assert(approxEqual(sum, 1.0, 0.0001), 'sum = 1.0');

  // Also test with very large quantities (simulate many bets)
  const largeQ = [5000, 100, 100, 100];
  const largePrices = computeMultiOutcomePrice(largeQ, b);
  const largeSum = largePrices.reduce((a, v) => a + v, 0);

  console.log(`  large quantities: [${largeQ}]`);
  console.log(`  large prices:     [${largePrices.map(p => p.toFixed(8))}]`);
  console.log(`  large sum: ${largeSum}`);

  assert(largePrices.every(p => Number.isFinite(p)), 'large quantities: all prices finite');
  assert(approxEqual(largeSum, 1.0, 0.0001), 'large quantities: sum = 1.0');
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) {
  process.exit(1);
}
