/**
 * LMSR (Logarithmic Market Scoring Rule) implementation.
 * Mirrors the mechanism used by Polymarket.
 *
 * Cost function:
 *   C(q) = b * ln( sum_i exp(q_i / b) )
 *
 * Cost of moving from q_old to q_new:
 *   cost = C(q_new) - C(q_old)
 *
 * GNS is scaled by /100 before cost calculation so that
 * bet sizes feel natural (2000 GNS ≈ $20 in market depth terms).
 */

const GNS_SCALE = 100;

/**
 * Parse a PostgreSQL NUMERIC[] column into a JavaScript number[].
 * Handles: JS array, pg string "{1,2,3}", null/undefined → empty array.
 */
export function parseNumericArray(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === 'string') {
    const trimmed = raw.replace(/[{}]/g, '').trim();
    if (trimmed === '') return [];
    return trimmed.split(',').map(Number);
  }
  return [];
}

/** Numerically stable log-sum-exp */
function logSumExp(qs: number[], b: number): number {
  const scaled = qs.map((q) => q / b);
  const max = Math.max(...scaled);
  const sum = scaled.reduce((acc, v) => acc + Math.exp(v - max), 0);
  return b * (max + Math.log(sum));
}

/** Cost of moving quantities from qOld to qNew */
export function lmsrCost(qOld: number[], qNew: number[], b: number): number {
  return logSumExp(qNew, b) - logSumExp(qOld, b);
}

/**
 * Current probability of each outcome given quantity state.
 * p_i = exp(q_i / b) / sum_j exp(q_j / b)
 */
export function lmsrProbs(quantities: number[], b: number): number[] {
  const scaled = quantities.map((q) => q / b);
  const max = Math.max(...scaled);
  const exps = scaled.map((v) => Math.exp(v - max));
  const total = exps.reduce((a, v) => a + v, 0);
  return exps.map((e) => e / total);
}

/**
 * Given a GNS budget, find the number of shares purchased on outcomeIndex
 * via binary search. Returns { shares, newQuantities, pricePerShare }.
 */
export function lmsrBuy(
  quantities: number[],
  b: number,
  outcomeIndex: number,
  gnsBudget: number
): { shares: number; newQuantities: number[]; pricePerShare: number } {
  const budget = gnsBudget / GNS_SCALE;

  let lo = 0;
  let hi = budget * 100; // upper bound: can't buy more shares than budget * 100 at price ~0.01

  for (let iter = 0; iter < 64; iter++) {
    const mid = (lo + hi) / 2;
    const qNew = quantities.map((q, i) => (i === outcomeIndex ? q + mid : q));
    const cost = lmsrCost(quantities, qNew, b);
    if (cost < budget) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const shares = (lo + hi) / 2;
  const newQuantities = quantities.map((q, i) =>
    i === outcomeIndex ? q + shares : q
  );
  const pricePerShare = shares > 0 ? gnsBudget / shares : 0;

  return { shares, newQuantities, pricePerShare };
}

/**
 * Compute the b parameter from real Polymarket volume.
 * b = max(sqrt(volume) * 0.18, 200)
 */
export function computeB(volume: number): number {
  return Math.max(Math.sqrt(Math.max(volume, 1)) * 0.18, 200);
}

/**
 * Bootstrap initial quantity state from Polymarket probabilities.
 * Sets quantities such that lmsrProbs(q, b) ≈ initialProbs.
 * q_i = b * ln(p_i) + constant (constant cancels in probs)
 */
export function bootstrapQuantities(probs: number[], b: number): number[] {
  // q_i = b * ln(p_i), shifted so min is 0
  const raw = probs.map((p) => b * Math.log(Math.max(p, 1e-9)));
  const minVal = Math.min(...raw);
  return raw.map((q) => q - minVal);
}

// ─── Multi-Outcome LMSR with Dynamic B ─────────────────────────────────────

/**
 * Dynamic b-parameter: scales with the number of active agents on an event.
 * More agents → deeper liquidity → more stable prices.
 */
export function computeDynamicB(baseB: number, activeAgents: number): number {
  return baseB * Math.sqrt(Math.max(activeAgents, 1));
}

/**
 * Multi-outcome LMSR cost function: C(q) = b * ln(Σ exp(q_i / b))
 * Uses log-sum-exp trick for numerical stability.
 */
export function computeMultiOutcomeCost(quantities: number[], b: number): number {
  const scaled = quantities.map((q) => q / b);
  const max = Math.max(...scaled);
  const sum = scaled.reduce((acc, v) => acc + Math.exp(v - max), 0);
  return b * (max + Math.log(sum));
}

/**
 * Multi-outcome price function: p_i = exp(q_i / b) / Σ exp(q_j / b)
 * Uses log-sum-exp trick — guaranteed to sum to 1.0.
 */
export function computeMultiOutcomePrice(quantities: number[], b: number): number[] {
  const scaled = quantities.map((q) => q / b);
  const max = Math.max(...scaled);
  const expShifted = scaled.map((v) => Math.exp(v - max));
  const sumExp = expShifted.reduce((a, v) => a + v, 0);
  const prices = expShifted.map((e) => e / sumExp);

  // Sanity check: no NaN or Infinity
  for (const p of prices) {
    if (!Number.isFinite(p)) {
      throw new Error(`LMSR price computation produced non-finite value. quantities=${JSON.stringify(quantities)}, b=${b}`);
    }
  }

  return prices;
}

/**
 * Cost of purchasing `shares` on `outcomeIndex`.
 * Returns C(q_after) - C(q_before).
 */
export function computeMultiOutcomePurchaseCost(
  quantities: number[],
  outcomeIndex: number,
  shares: number,
  b: number,
): number {
  const newQuantities = quantities.map((q, i) => (i === outcomeIndex ? q + shares : q));
  return computeMultiOutcomeCost(newQuantities, b) - computeMultiOutcomeCost(quantities, b);
}

/**
 * Binary search to find shares such that purchase cost ≈ gnsAmount.
 * Precision: within 0.001 GNS. Max iterations: 100.
 */
export function computeMultiOutcomeSharesForCost(
  quantities: number[],
  outcomeIndex: number,
  gnsAmount: number,
  b: number,
): number {
  let lo = 0;
  let hi = gnsAmount * 100; // generous upper bound

  for (let iter = 0; iter < 100; iter++) {
    const mid = (lo + hi) / 2;
    const cost = computeMultiOutcomePurchaseCost(quantities, outcomeIndex, mid, b);
    if (Math.abs(cost - gnsAmount) < 0.001) {
      return mid;
    }
    if (cost < gnsAmount) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return (lo + hi) / 2;
}

/**
 * Bootstrap multi-outcome event quantities from probabilities.
 * q_i = b * ln(p_i), with p_i floored at 0.001 to avoid -Infinity.
 */
export function bootstrapEventQuantities(probs: number[], b: number): number[] {
  const raw = probs.map((p) => b * Math.log(Math.max(p, 0.001)));
  const minVal = Math.min(...raw);
  return raw.map((q) => q - minVal);
}
