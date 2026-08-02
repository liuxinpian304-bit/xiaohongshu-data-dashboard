import type { Queue } from 'bullmq';
import type { JobsOptions } from 'bullmq';
import type { ReportType } from '@xhs/domain';

import type { ReportJobData, ReportJobName } from './report.processor';

export interface ScheduledReportJob { name: ReportJobName; jobId: string }

export function reportJobsForTick(now: Date): ScheduledReportJob[] {
  const parts = shanghaiParts(now);
  const jobs: ScheduledReportJob[] = [job('generate-daily-report', 'daily', parts.date)];
  if (parts.weekday === 'Mon') jobs.push(job('generate-weekly-report', 'weekly', parts.date));
  if (parts.day === 1) jobs.push(job('generate-monthly-report', 'monthly', parts.date));
  return jobs;
}

export async function enqueueScheduledReports(queue: Queue<ReportJobData>, now = new Date()) {
  return Promise.all(reportJobsForTick(now).map(({ name, jobId }) => queue.add(
    name,
    { now: now.toISOString() },
    reportJobOptions(jobId),
  )));
}

export function reportJobOptions(jobId: string): JobsOptions {
  return { jobId, removeOnComplete: { age: 8 * 24 * 60 * 60 }, attempts: 3, backoff: { type: 'exponential', delay: 1_000 } };
}

export function rebuildReportJob(type: ReportType, now: Date, backfillId: string) {
  const jobId = `report:rebuild:${type}:${backfillId}`;
  return { name: 'rebuild-report' as const, data: { type, now: now.toISOString() }, options: reportJobOptions(jobId) };
}

export function enqueueReportRebuild(queue: Queue<ReportJobData>, type: ReportType, now: Date, backfillId: string) {
  const rebuild = rebuildReportJob(type, now, backfillId);
  return queue.add(rebuild.name, rebuild.data, rebuild.options);
}

export function startReportScheduler(queue: Queue<ReportJobData>) {
  void enqueueScheduledReports(queue);
  const timer = setInterval(() => void enqueueScheduledReports(queue), 60_000);
  return { close: async () => clearInterval(timer) };
}

function job(name: ReportJobName, type: string, date: string): ScheduledReportJob {
  return { name, jobId: `report:${type}:${date}` };
}

function shanghaiParts(now: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, day: Number(parts.day), weekday: parts.weekday };
}
