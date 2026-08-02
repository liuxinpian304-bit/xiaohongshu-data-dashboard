import type { Queue } from 'bullmq';
import type { JobsOptions } from 'bullmq';
import type { ReportType } from '@xhs/domain';
import type { DatabaseClient } from '@xhs/database';

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
  const jobId = `report-rebuild-${type}-${backfillId}`;
  return { name: 'rebuild-report' as const, data: { type, now: now.toISOString() }, options: reportJobOptions(jobId) };
}

export function enqueueReportRebuild(queue: Queue<ReportJobData>, type: ReportType, now: Date, backfillId: string) {
  const rebuild = rebuildReportJob(type, now, backfillId);
  return queue.add(rebuild.name, rebuild.data, rebuild.options);
}

export interface AffectedReport {
  id: string;
  accountId: string;
  type: ReportType;
  periodEnd: Date;
}

export interface BackfillCommittedEvent {
  backfillId: string;
  accountId: string;
  noteId: string;
  capturedDates: string[];
  reason: string;
}

export interface AffectedReportStore {
  findAffectedReports(event: BackfillCommittedEvent): Promise<AffectedReport[]>;
}

export class PrismaAffectedReportStore implements AffectedReportStore {
  constructor(private readonly db: DatabaseClient) {}

  async findAffectedReports(event: BackfillCommittedEvent) {
    const reports = await this.db.report.findMany({
      where: { accountId: event.accountId, status: 'awaiting_data', missingDates: { hasSome: event.capturedDates } },
      select: { id: true, accountId: true, reportType: true, periodEnd: true },
      orderBy: { version: 'desc' },
    });
    const scopes = new Map<string, AffectedReport>();
    for (const report of reports) {
      const key = `${report.reportType}\0${report.periodEnd.toISOString()}`;
      if (!scopes.has(key)) scopes.set(key, { ...report, type: report.reportType as ReportType });
    }
    return [...scopes.values()];
  }
}

export class ReportRebuildDispatcher {
  constructor(private readonly store: AffectedReportStore, private readonly queue: Queue<ReportJobData>) {}

  async handle(event: BackfillCommittedEvent) {
    for (const report of await this.store.findAffectedReports(event)) {
      const jobId = `report-rebuild-${report.type}-${event.backfillId}-${report.id}`;
      await this.queue.add('rebuild-report', {
        type: report.type,
        now: new Date(report.periodEnd.getTime() + 1).toISOString(),
        accountId: report.accountId,
        backfillId: event.backfillId,
        previousReportId: report.id,
        rebuildReason: event.reason,
      }, reportJobOptions(jobId));
    }
  }
}

export function startReportScheduler(queue: Queue<ReportJobData>) {
  void runScheduledReportTick(queue);
  const timer = setInterval(() => void runScheduledReportTick(queue), 60_000);
  return { close: async () => clearInterval(timer) };
}

export async function runScheduledReportTick(
  queue: Pick<Queue<ReportJobData>, 'add'>,
  now = new Date(),
  logError: (entry: unknown) => void = (entry) => console.error(JSON.stringify(entry)),
) {
  try {
    await enqueueScheduledReports(queue as Queue<ReportJobData>, now);
  } catch (error) {
    logError({
      service: 'worker', component: 'report-scheduler', event: 'enqueue_failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function job(name: ReportJobName, type: string, date: string): ScheduledReportJob {
  return { name, jobId: `report-${type}-${date}` };
}

function shanghaiParts(now: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, day: Number(parts.day), weekday: parts.weekday };
}
