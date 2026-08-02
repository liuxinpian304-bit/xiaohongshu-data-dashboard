import { describe, expect, it } from 'vitest';

import { getReportPeriod } from './report-period';

describe('getReportPeriod', () => {
  it('builds a daily report for the previous Shanghai calendar day', () => {
    expect(getReportPeriod('daily', new Date('2026-08-03T01:00:00+08:00'))).toEqual({
      type: 'daily',
      start: new Date('2026-08-02T00:00:00+08:00'),
      end: new Date('2026-08-02T23:59:59.999+08:00'),
      label: '2026年08月02日',
    });
  });

  it('builds Monday weekly report for the previous natural week', () => {
    expect(getReportPeriod('weekly', new Date('2026-08-03T01:00:00+08:00'))).toEqual({
      type: 'weekly',
      start: new Date('2026-07-27T00:00:00+08:00'),
      end: new Date('2026-08-02T23:59:59.999+08:00'),
      label: '2026年第31周',
    });
  });

  it('uses the ISO week-year when the previous week crosses a calendar year', () => {
    expect(getReportPeriod('weekly', new Date('2021-01-04T12:00:00+08:00'))).toEqual({
      type: 'weekly',
      start: new Date('2020-12-28T00:00:00+08:00'),
      end: new Date('2021-01-03T23:59:59.999+08:00'),
      label: '2020年第53周',
    });
  });

  it('builds a monthly report for the previous natural month', () => {
    expect(getReportPeriod('monthly', new Date('2026-08-15T12:00:00+08:00'))).toEqual({
      type: 'monthly',
      start: new Date('2026-07-01T00:00:00+08:00'),
      end: new Date('2026-07-31T23:59:59.999+08:00'),
      label: '2026年07月',
    });
  });

  it('includes February 29 when the previous month is in a leap year', () => {
    expect(getReportPeriod('monthly', new Date('2024-03-10T12:00:00+08:00'))).toEqual({
      type: 'monthly',
      start: new Date('2024-02-01T00:00:00+08:00'),
      end: new Date('2024-02-29T23:59:59.999+08:00'),
      label: '2024年02月',
    });
  });
});
