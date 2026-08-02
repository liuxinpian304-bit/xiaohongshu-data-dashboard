import { describe, expect, it } from 'vitest';

import { rebuildReportJob } from './report.scheduler';
import { reportJobOptions, reportJobsForTick } from './report.scheduler';

describe('reportJobsForTick', () => {
  it('enqueues daily and weekly reports on a Shanghai Monday only once per business date', () => {
    expect(reportJobsForTick(new Date('2026-08-02T16:05:00Z'))).toEqual([
      { name: 'generate-daily-report', jobId: 'report:daily:2026-08-03' },
      { name: 'generate-weekly-report', jobId: 'report:weekly:2026-08-03' },
    ]);
  });

  it('enqueues monthly reports only on the first Shanghai calendar day', () => {
    expect(reportJobsForTick(new Date('2026-08-31T16:05:00Z'))).toEqual([
      { name: 'generate-daily-report', jobId: 'report:daily:2026-09-01' },
      { name: 'generate-monthly-report', jobId: 'report:monthly:2026-09-01' },
    ]);
  });

  it('does not use the UTC date when Shanghai is already on the next day', () => {
    expect(reportJobsForTick(new Date('2026-08-02T15:59:00Z'))).toEqual([
      { name: 'generate-daily-report', jobId: 'report:daily:2026-08-02' },
    ]);
  });

  it('retains completed jobs long enough for restarts to reuse the stable job id', () => {
    expect(reportJobOptions('report:daily:2026-08-03')).toMatchObject({
      jobId: 'report:daily:2026-08-03',
      removeOnComplete: { age: 691_200 },
    });
  });

  it('creates a stable rebuild job for one backfill event', () => {
    expect(rebuildReportJob('weekly', new Date('2026-08-03T00:05:00+08:00'), 'snapshot-42')).toEqual({
      name: 'rebuild-report',
      data: { type: 'weekly', now: '2026-08-02T16:05:00.000Z' },
      options: expect.objectContaining({ jobId: 'report:rebuild:weekly:snapshot-42' }),
    });
  });
});
