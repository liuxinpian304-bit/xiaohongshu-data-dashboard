import { describe, expect, it } from 'vitest';

import { aggregateCumulative, aggregateMetricSeries, aggregateMetricSeriesWithTrace } from './metric-aggregation';

describe('aggregateCumulative', () => {
  it('uses the first and last snapshots instead of summing cumulative totals', () => {
    expect(aggregateCumulative([100, 130, 151])).toBe(51);
  });
});

describe('aggregateMetricSeries', () => {
  it('returns only evidence actually consumed by each aggregation semantic', () => {
    const start = new Date('2026-01-01'); const middle = new Date('2026-01-02'); const end = new Date('2026-01-03');
    expect(aggregateMetricSeriesWithTrace('cumulative_delta', [{ evidenceId: 'base', value: 10 }, { evidenceId: 'middle', value: 12 }, { evidenceId: 'end', value: 15 }]).usedEvidenceIds).toEqual(['base', 'middle', 'end']);
    expect(aggregateMetricSeriesWithTrace('period_end', [{ evidenceId: 'noise', value: 1 }, { evidenceId: 'chosen', value: 9, authoritativePeriod: true, windowEnd: end }], { start, endExclusive: end }).usedEvidenceIds).toEqual(['chosen']);
    expect(aggregateMetricSeriesWithTrace('deduplicated_period', [{ evidenceId: 'chosen', value: 4, authoritativePeriod: true, windowStart: start, windowEnd: end }], { start, endExclusive: end }).usedEvidenceIds).toEqual(['chosen']);
    expect(aggregateMetricSeriesWithTrace('sum_interval', [{ evidenceId: 'a', value: 3, authoritativePeriod: true, windowStart: start, windowEnd: middle }, { evidenceId: 'b', value: 4, authoritativePeriod: true, windowStart: middle, windowEnd: end }], { start, endExclusive: end }).usedEvidenceIds).toEqual(['a', 'b']);
  });
  it('applies all explicit semantics without guessing deduplicated values', () => {
    expect(aggregateMetricSeries('cumulative_delta', [{ value: 100 }, { value: 120 }, { value: 4 }, { value: 9 }])).toBe(29);
    const start = new Date('2026-01-01'); const middle = new Date('2026-01-02'); const end = new Date('2026-01-03'); const period = { start, endExclusive: end };
    expect(aggregateMetricSeries('sum_interval', [{ value: 3, authoritativePeriod: true, windowStart: start, windowEnd: middle }, { value: 4, authoritativePeriod: true, windowStart: middle, windowEnd: end }], period)).toBe(7);
    expect(aggregateMetricSeries('sum_interval', [{ value: 3, authoritativePeriod: true, windowStart: start, windowEnd: middle }], period)).toBeNull();
    expect(aggregateMetricSeries('period_end', [{ value: 4, authoritativePeriod: true, windowEnd: end }], period)).toBe(4);
    expect(aggregateMetricSeries('deduplicated_period', [{ value: 4 }])).toBeNull();
    expect(aggregateMetricSeries('deduplicated_period', [{ value: 4, authoritativePeriod: true, windowStart: start, windowEnd: end }], period)).toBe(4);
  });

  it.each([
    ['weekly', new Date('2026-07-26T16:00:00Z'), 7],
    ['monthly', new Date('2026-06-30T16:00:00Z'), 31],
  ])('covers Asia/Shanghai %s with contiguous UTC half-open daily windows', (_type, start, days) => {
    const series = Array.from({ length: days }, (_, index) => ({ value: 1, authoritativePeriod: true, windowStart: new Date(start.getTime() + index * 86_400_000), windowEnd: new Date(start.getTime() + (index + 1) * 86_400_000) }));
    const endExclusive = new Date(start.getTime() + days * 86_400_000);
    expect(aggregateMetricSeries('sum_interval', series, { start, endExclusive })).toBe(days);
    expect(aggregateMetricSeries('sum_interval', [...series.slice(0, 1), ...series.slice(2)], { start, endExclusive })).toBeNull();
    expect(aggregateMetricSeries('sum_interval', [{ ...series[0]!, windowEnd: series[1]!.windowEnd! }, ...series.slice(1)], { start, endExclusive })).toBeNull();
  });
});
