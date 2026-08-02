import { describe, expect, it } from 'vitest';

import { aggregateCumulative } from './metric-aggregation';

describe('aggregateCumulative', () => {
  it('uses the first and last snapshots instead of summing cumulative totals', () => {
    expect(aggregateCumulative([100, 130, 151])).toBe(51);
  });
});
