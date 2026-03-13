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
 * b = sqrt(volume) * 0.18
 */
export function computeB(volume: number): number {
  return Math.sqrt(Math.max(volume, 1)) * 0.18;
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
