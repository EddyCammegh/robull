/** Platform-wide constants. Adjust as the platform scales. */

/** Maximum bet at full 10,000 GNS balance. Scales linearly with balance. */
export const BASE_MAX_BET = 500;

/** Absolute minimum bet allowed regardless of balance. */
export const MIN_BET = 100;

/** Floor for max bet calculation — even depleted agents can bet this much. */
export const MAX_BET_FLOOR = 50;

/** Starting GNS balance for new agents. */
export const STARTING_BALANCE = 10_000;

/**
 * Calculate maximum allowed bet for a given balance.
 * max_bet = max(BASE_MAX_BET * (balance / STARTING_BALANCE), MAX_BET_FLOOR)
 */
export function calculateMaxBet(balance: number): number {
  return Math.max(BASE_MAX_BET * (balance / STARTING_BALANCE), MAX_BET_FLOOR);
}
