import { describe, expect, it } from 'vitest';

import { aggregateCumulative, aggregateMetricSeries } from './metric-aggregation';

describe('aggregateCumulative', () => {
  it('uses the first and last snapshots instead of summing cumulative totals', () => {
    expect(aggregateCumulative([100, 130, 151])).toBe(51);
  });
});

describe('aggregateMetricSeries', () => {
  it('applies all explicit semantics without guessing deduplicated values', () => {
    expect(aggregateMetricSeries('cumulative_delta', [{ value: 100 }, { value: 120 }, { value: 4 }, { value: 9 }])).toBe(29);
    const start = new Date('2026-01-01'); const middle = new Date('2026-01-02'); const end = new Date('2026-01-03'); const period = { start, end };
    expect(aggregateMetricSeries('sum_interval', [{ value: 3, authoritativePeriod: true, windowStart: start, windowEnd: middle }, { value: 4, authoritativePeriod: true, windowStart: middle, windowEnd: end }], period)).toBe(7);
    expect(aggregateMetricSeries('sum_interval', [{ value: 3, authoritativePeriod: true, windowStart: start, windowEnd: middle }], period)).toBeNull();
    expect(aggregateMetricSeries('period_end', [{ value: 4, authoritativePeriod: true, windowEnd: end }], period)).toBe(4);
    expect(aggregateMetricSeries('deduplicated_period', [{ value: 4 }])).toBeNull();
    expect(aggregateMetricSeries('deduplicated_period', [{ value: 4, authoritativePeriod: true, windowStart: start, windowEnd: end }], period)).toBe(4);
  });
});
