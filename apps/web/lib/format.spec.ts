import { describe, expect, it } from 'vitest';

import { formatReportRange } from './format';

describe('formatReportRange', () => {
  it('formats server-authoritative cross-year boundaries in Shanghai time', () => {
    expect(formatReportRange('2025-12-28T16:00:00.000Z', '2026-01-04T15:59:59.999Z')).toBe('2025-12-29 — 2026-01-04');
  });

  it('collapses a daily range to one date', () => {
    expect(formatReportRange('2026-07-31T16:00:00.000Z', '2026-08-01T15:59:59.999Z')).toBe('2026-08-01');
  });
});
