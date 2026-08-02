import { describe, expect, it } from 'vitest';
import type { Job } from 'bullmq';
import { processReportJob, type ReportJobData, type ReportJobName } from './report.processor';
import type { ReportService } from './report.service';

describe('report notification events', () => {
  it.each([['generate-daily-report', 'report_generated'], ['rebuild-report', 'report_rebuilt']] as const)('publishes %s outcome as %s', async (name, eventType) => {
    const events: unknown[] = [];
    const service = { generateReport: async () => ({ status: 'complete', missingDates: [], missingFields: [], reports: [{ id: 'report-1', accountId: 'account-1', version: 1, status: 'complete' }] }) } as unknown as ReportService;
    const publisher = { publish: async (event: unknown) => { events.push(event); } };
    const job = { id: 'report-job-1', name, data: { now: new Date().toISOString(), type: 'daily' } } as Job<ReportJobData, never, ReportJobName>;
    await processReportJob(service, job, publisher);
    expect(events).toEqual([{ id: `report:${eventType}:report-1:1`, type: eventType, accountId: 'account-1', data: { reportId: 'report-1' } }]);
  });
});
