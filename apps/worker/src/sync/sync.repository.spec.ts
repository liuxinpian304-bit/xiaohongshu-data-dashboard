import { describe, expect, it } from 'vitest';

import { backfillBusinessDates } from './sync.repository';

describe('backfillBusinessDates', () => {
  it('uses the Shanghai date when a UTC snapshot falls after Shanghai midnight', () => {
    expect(backfillBusinessDates([{ capturedAt: '2026-07-31T16:15:00.000Z' }])).toEqual(['2026-08-01']);
  });
});
