import { Queue, Worker, type Job } from 'bullmq';
import type { ReportType } from '@xhs/domain';

import { redisConnection } from '../queues';
import type { ReportResult, ReportService } from './report.service';
import type { NotificationEventPublisher } from '../notification/notification.publisher';

export const REPORT_QUEUE = 'reports';
export type ReportJobName = 'generate-daily-report' | 'generate-weekly-report' | 'generate-monthly-report' | 'rebuild-report';
export interface ReportJobData {
  now: string;
  type?: ReportType;
  accountId?: string;
  backfillId?: string;
  previousReportId?: string;
  rebuildReason?: string;
}

export function createReportQueue() { return new Queue<ReportJobData>(REPORT_QUEUE, { connection: redisConnection() }); }

export async function processReportJob(service: ReportService, job: Job<ReportJobData, ReportResult, ReportJobName>, notifications?: NotificationEventPublisher) {
  const result = await service.generateReport(reportType(job), new Date(job.data.now), {
    accountId: job.data.accountId,
    backfillId: job.data.backfillId,
    rebuildJobId: job.id,
    previousReportId: job.data.previousReportId,
    rebuildReason: job.data.rebuildReason,
  });
  const eventType = job.name === 'rebuild-report' ? 'report_rebuilt' : 'report_generated';
  await Promise.all(result.reports.map(async (report) => {
    try { await notifications?.publish({ id: `report:${eventType}:${report.id}:${report.version}`, type: eventType, accountId: report.accountId, data: { reportId: report.id } }); } catch { /* notification delivery cannot fail report generation */ }
  }));
  return result;
}

export function createReportWorker(service: ReportService, notifications?: NotificationEventPublisher) {
  return new Worker<ReportJobData, ReportResult, ReportJobName>(REPORT_QUEUE, (job) => processReportJob(service, job, notifications), {
    connection: redisConnection(), concurrency: Number(process.env.REPORT_CONCURRENCY ?? 2),
  });
}

function reportType(job: Job<ReportJobData, ReportResult, ReportJobName>): ReportType {
  if (job.name === 'rebuild-report') {
    if (!job.data.type) throw new Error('rebuild-report requires a report type');
    return job.data.type;
  }
  if (job.name === 'generate-weekly-report') return 'weekly';
  if (job.name === 'generate-monthly-report') return 'monthly';
  return 'daily';
}
