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

  it('publishes awaiting-data instead of a generated notification when monthly finalization is incomplete', async () => {
    const events: unknown[] = [];
    const service = { generateReport: async () => ({ status: 'awaiting_data', missingDates: ['2026-07-17'], missingFields: [{ noteId: 'note-1', metricDefinitionId: 'views', date: '2026-07-17' }], reports: [{ id: 'report-1', accountId: 'account-1', version: 1, status: 'awaiting_data', missingDates: ['2026-07-17'], missingFields: [{ noteId: 'note-1', metricDefinitionId: 'views', date: '2026-07-17' }] }] }) } as unknown as ReportService;
    const job = { id: 'monthly-final', name: 'generate-monthly-report', data: { now: '2026-08-01T00:05:00+08:00' } } as Job<ReportJobData, never, ReportJobName>;
    await processReportJob(service, job, { publish: async (event) => { events.push(event); } });
    expect(events).toEqual([{ id: 'report:awaiting-data:report-1:1', type: 'report_awaiting_data', accountId: 'account-1', data: { reportId: 'report-1', missingDates: ['2026-07-17'], missingFields: [{ noteId: 'note-1', metricDefinitionId: 'views', date: '2026-07-17' }] } }]);
  });

  it('uses each account report missing dates without leaking the aggregate from another account', async () => {
    const events: unknown[] = [];
    const service = { generateReport: async () => ({ status: 'awaiting_data', missingDates: ['2026-07-03', '2026-07-17'], missingFields: [], reports: [
      { id: 'report-a', accountId: 'account-a', version: 1, status: 'awaiting_data', missingDates: ['2026-07-03'], missingFields: [] },
      { id: 'report-b', accountId: 'account-b', version: 1, status: 'awaiting_data', missingDates: ['2026-07-17'], missingFields: [] },
    ] }) } as unknown as ReportService;
    await processReportJob(service, { id: 'monthly', name: 'generate-monthly-report', data: { now: '2026-08-01T00:05:00+08:00' } } as Job<ReportJobData, never, ReportJobName>, { publish: async (event) => { events.push(event); } });
    expect(events).toEqual([
      expect.objectContaining({ accountId: 'account-a', data: { reportId: 'report-a', missingDates: ['2026-07-03'], missingFields: [] } }),
      expect.objectContaining({ accountId: 'account-b', data: { reportId: 'report-b', missingDates: ['2026-07-17'], missingFields: [] } }),
    ]);
  });
});
