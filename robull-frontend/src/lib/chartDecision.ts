/**
 * Smart chart decision engine.
 *
 * Determines the best chart type for a given event based on outcome count,
 * price history depth, probability movement, and volume. Adjust CHART_CONFIG
 * values as the platform scales.
 */

export const CHART_CONFIG = {
  /** Minimum data points before switching to line graph */
  MIN_HISTORY_POINTS_FOR_LINE: 5,
  /** More outcomes than this → list (too many lines to read) */
  MAX_OUTCOMES_FOR_LINE: 6,
  /** Minimum % movement across history to justify a line graph */
  MIN_PROBABILITY_MOVEMENT_FOR_LINE: 5,
  /** Minimum Polymarket volume to show line graph (low volume = noisy) */
  LINE_GRAPH_THRESHOLD_VOLUME: 50000,
  /** Binary markets need stronger signal to justify a line */
  BINARY_MIN_HISTORY_POINTS: 10,
  BINARY_MIN_MOVEMENT: 10,
};

export type ChartType = 'line' | 'bar' | 'list';

interface ChartDecisionEvent {
  outcomes: { probability: number; passed?: boolean; active?: boolean }[];
  event_type?: string;
  volume?: number;
  created_at?: string;
}

type PriceHistoryMap = Record<string, { probability: number; recorded_at: string }[]>;

interface ChartDecisionResult {
  type: ChartType;
  reason: string;
}

/**
 * Compute the max absolute probability movement (in %) across all outcomes.
 */
function maxMovement(history: PriceHistoryMap): number {
  let maxMov = 0;
  for (const idx of Object.keys(history)) {
    const pts = history[idx];
    if (!pts || pts.length < 2) continue;
    let min = Infinity;
    let max = -Infinity;
    for (const p of pts) {
      const v = p.probability * 100;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const mov = max - min;
    if (mov > maxMov) maxMov = mov;
  }
  return maxMov;
}

/**
 * Count total data points across all outcomes (uses max per-outcome count).
 */
function historyPointCount(history: PriceHistoryMap): number {
  let max = 0;
  for (const idx of Object.keys(history)) {
    const len = history[idx]?.length ?? 0;
    if (len > max) max = len;
  }
  return max;
}

export function getChartType(
  event: ChartDecisionEvent,
  priceHistory?: PriceHistoryMap | null,
): ChartDecisionResult {
  const activeOutcomes = event.outcomes.filter(o => !(o.passed ?? false));
  const outcomeCount = activeOutcomes.length;
  const volume = event.volume ?? 0;
  const history = priceHistory ?? {};
  const points = historyPointCount(history);
  const movement = maxMovement(history);

  // New market (< 24h old): always bar
  if (event.created_at) {
    const age = Date.now() - new Date(event.created_at).getTime();
    if (age < 24 * 60 * 60 * 1000) {
      return { type: 'bar', reason: `new market (<24h old)` };
    }
  }

  // Step 1 — Force LIST
  if (outcomeCount > CHART_CONFIG.MAX_OUTCOMES_FOR_LINE) {
    return { type: 'list', reason: `${outcomeCount} outcomes > ${CHART_CONFIG.MAX_OUTCOMES_FOR_LINE} max` };
  }
  if (event.event_type === 'independent' || event.event_type === 'sports_props') {
    return { type: 'list', reason: `independent/threshold event — lines mislead` };
  }

  // Binary market special case
  if (outcomeCount <= 2) {
    if (points >= CHART_CONFIG.BINARY_MIN_HISTORY_POINTS && movement >= CHART_CONFIG.BINARY_MIN_MOVEMENT) {
      return { type: 'line', reason: `binary with ${points} pts, ${movement.toFixed(1)}% movement` };
    }
    return { type: 'bar', reason: `binary (${points} pts, ${movement.toFixed(1)}% movement — below threshold)` };
  }

  // Step 2 — Force BAR
  if (points < CHART_CONFIG.MIN_HISTORY_POINTS_FOR_LINE) {
    return { type: 'bar', reason: `${points} pts < ${CHART_CONFIG.MIN_HISTORY_POINTS_FOR_LINE} min` };
  }
  if (movement < CHART_CONFIG.MIN_PROBABILITY_MOVEMENT_FOR_LINE) {
    return { type: 'bar', reason: `${movement.toFixed(1)}% movement < ${CHART_CONFIG.MIN_PROBABILITY_MOVEMENT_FOR_LINE}% min` };
  }
  if (volume < CHART_CONFIG.LINE_GRAPH_THRESHOLD_VOLUME) {
    return { type: 'bar', reason: `$${volume.toLocaleString()} volume < $${CHART_CONFIG.LINE_GRAPH_THRESHOLD_VOLUME.toLocaleString()} threshold` };
  }

  // Step 3 — LINE
  return { type: 'line', reason: `${outcomeCount} outcomes, ${points} pts, ${movement.toFixed(1)}% movement` };
}
