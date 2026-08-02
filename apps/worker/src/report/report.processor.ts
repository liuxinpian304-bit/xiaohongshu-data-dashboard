import { Queue, Worker, type Job } from 'bullmq';
import type { ReportType } from '@xhs/domain';

import { redisConnection } from '../queues';
import type { ReportResult, ReportService } from './report.service';

export const REPORT_QUEUE = 'reports';
export type ReportJobName = 'generate-daily-report' | 'generate-weekly-report' | 'generate-monthly-report' | 'rebuild-report';
export interface ReportJobData { now: string; type?: ReportType }

export function createReportQueue() { return new Queue<ReportJobData>(REPORT_QUEUE, { connection: redisConnection() }); }

export function processReportJob(service: ReportService, job: Job<ReportJobData, ReportResult, ReportJobName>) {
  return service.generateReport(reportType(job), new Date(job.data.now));
}

export function createReportWorker(service: ReportService) {
  return new Worker<ReportJobData, ReportResult, ReportJobName>(REPORT_QUEUE, (job) => processReportJob(service, job), {
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
