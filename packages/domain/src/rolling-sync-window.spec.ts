import { describe, expect, it } from 'vitest';

import { getRollingSyncDates, rollingSyncJobId } from './rolling-sync-window';

describe('getRollingSyncDates', () => {
  it.each([
    ['2026-08-03T00:30:00+08:00', 'month_to_date', ['2026-08-01', '2026-08-02']],
    ['2026-08-04T23:59:00+08:00', 'month_to_date', ['2026-08-01', '2026-08-02', '2026-08-03']],
  ] as const)('returns completed Shanghai month-to-date days for %s', (now, mode, dates) => {
    expect(getRollingSyncDates(new Date(now))).toEqual({ mode, dates });
  });

  it('uses the Shanghai business date instead of the host time zone', () => {
    expect(getRollingSyncDates(new Date('2026-08-02T16:30:00Z'))).toEqual({
      mode: 'month_to_date',
      dates: ['2026-08-01', '2026-08-02'],
    });
  });

  it.each([
    ['2026-09-01T01:00:00+08:00', '2026-08-01', '2026-08-31', 31],
    ['2027-01-01T01:00:00+08:00', '2026-12-01', '2026-12-31', 31],
  ] as const)('returns the complete previous month on month start %s', (now, first, last, count) => {
    const result = getRollingSyncDates(new Date(now));
    expect(result.mode).toBe('previous_month_final');
    expect(result.dates).toHaveLength(count);
    expect(result.dates.at(0)).toBe(first);
    expect(result.dates.at(-1)).toBe(last);
  });

  it('never includes the current Shanghai business date', () => {
    expect(getRollingSyncDates(new Date('2026-08-04T10:00:00+08:00')).dates).not.toContain('2026-08-04');
  });

  it('is invariant across host time zones at Shanghai month and year boundaries', () => {
    const originalTimeZone = process.env.TZ;
    try {
      const results = ['UTC', 'America/Los_Angeles', 'Asia/Shanghai'].map((timeZone) => {
        process.env.TZ = timeZone;
        return [
          getRollingSyncDates(new Date('2026-08-31T16:00:00.000Z')),
          getRollingSyncDates(new Date('2026-12-31T16:00:00.000Z')),
        ];
      });
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
      expect(results[0]?.[0]).toMatchObject({ mode: 'previous_month_final', dates: expect.arrayContaining(['2026-08-01', '2026-08-31']) });
      expect(results[0]?.[1]).toMatchObject({ mode: 'previous_month_final', dates: expect.arrayContaining(['2026-12-01', '2026-12-31']) });
    } finally {
      process.env.TZ = originalTimeZone;
    }
  });
});

describe('rollingSyncJobId', () => {
  it('keeps account, business date, and mode in a stable task identity', () => {
    expect(rollingSyncJobId('account-1', '2026-08-02', 'month_to_date')).toBe(
      rollingSyncJobId('account-1', '2026-08-02', 'month_to_date'),
    );
    expect(rollingSyncJobId('account-1', '2026-08-02', 'month_to_date')).not.toBe(
      rollingSyncJobId('account-1', '2026-08-02', 'previous_month_final'),
    );
  });
});
