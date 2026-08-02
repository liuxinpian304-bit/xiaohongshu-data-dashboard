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
    expect(aggregateMetricSeries('sum_interval', [{ value: 3 }, { value: 4 }])).toBe(7);
    expect(aggregateMetricSeries('period_end', [{ value: 3 }, { value: 4 }])).toBe(4);
    expect(aggregateMetricSeries('deduplicated_period', [{ value: 4 }])).toBeNull();
    expect(aggregateMetricSeries('deduplicated_period', [{ value: 4, authoritativePeriod: true }])).toBe(4);
  });
});
