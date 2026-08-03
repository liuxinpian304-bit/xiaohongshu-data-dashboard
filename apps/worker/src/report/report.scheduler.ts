import type { Queue } from 'bullmq';
import type { JobsOptions } from 'bullmq';
import type { ReportType } from '@xhs/domain';
import type { DatabaseClient } from '@xhs/database';
import { createHash, randomUUID } from 'node:crypto';

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
  periodStart: Date;
  periodEnd: Date;
}

export interface BackfillCommittedEvent {
  backfillId: string;
  accountId: string;
  noteId: string;
  capturedDates: string[];
  reason: string;
}

export interface ClaimedBackfillEvent extends BackfillCommittedEvent { claimToken: string }

export interface AffectedReportStore {
  findAffectedReports(event: BackfillCommittedEvent): Promise<AffectedReport[]>;
  claimPendingEvents?(claimToken?: string, now?: Date): Promise<ClaimedBackfillEvent[]>;
  markDispatched?(backfillId: string, claimToken: string): Promise<void>;
  markDispatchFailed?(backfillId: string, error: string, claimToken: string): Promise<void>;
}

export class OwnershipLostError extends Error {
  constructor(backfillId: string) {
    super(`Outbox claim lost for backfill event ${backfillId}`);
    this.name = 'OwnershipLostError';
  }
}

export class DispatchStateConsistencyError extends Error {
  constructor(backfillId: string, count: number) {
    super(`Terminal outbox update for backfill event ${backfillId} affected ${count} rows; expected exactly 1`);
    this.name = 'DispatchStateConsistencyError';
  }
}

export class PrismaAffectedReportStore implements AffectedReportStore {
  constructor(private readonly db: DatabaseClient) {}

  async findAffectedReports(event: BackfillCommittedEvent) {
    const reports = await this.db.report.findMany({
      where: { accountId: event.accountId },
      select: { id: true, accountId: true, reportType: true, periodStart: true, periodEnd: true, version: true, status: true, missingDates: true },
      orderBy: { version: 'desc' },
    });
    const seenScopes = new Set<string>();
    const affected: AffectedReport[] = [];
    for (const report of [...reports].sort((a, b) => b.version - a.version)) {
      const key = `${report.reportType}\0${report.periodStart.toISOString()}\0${report.periodEnd.toISOString()}`;
      if (seenScopes.has(key)) continue;
      seenScopes.add(key);
      if (event.capturedDates.some((date) => reportContainsBusinessDate(report.periodStart, report.periodEnd, date))) {
        affected.push({ ...report, type: report.reportType as ReportType });
      }
    }
    return affected;
  }

  async claimPendingEvents(claimToken: string = randomUUID(), now = new Date()) {
    const leaseExpiredAt = new Date(now.getTime() - 5 * 60_000);
    const events = await this.db.$queryRaw<Array<{ id: string; accountId: string; noteId: string; capturedDates: string[]; reason: string }>>`
      UPDATE "BackfillEvent" SET "dispatchStatus" = 'processing', "claimToken" = ${claimToken}, "claimedAt" = ${now}
      WHERE id IN (
        SELECT id FROM "BackfillEvent"
        WHERE "dispatchStatus" IN ('pending', 'failed') OR ("dispatchStatus" = 'processing' AND "claimedAt" < ${leaseExpiredAt})
        ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 100
      )
      RETURNING id, "accountId", "noteId", "capturedDates", reason
    `;
    return events.map((event) => ({ backfillId: event.id, accountId: event.accountId, noteId: event.noteId, capturedDates: event.capturedDates, reason: event.reason, claimToken }));
  }
  async markDispatched(backfillId: string, claimToken: string) { await this.updateDispatch(backfillId, claimToken, { dispatchStatus: 'dispatched', dispatchedAt: new Date(), attempts: { increment: 1 }, lastError: null, claimToken: null, claimedAt: null }); }
  async markDispatchFailed(backfillId: string, error: string, claimToken: string) { await this.updateDispatch(backfillId, claimToken, { dispatchStatus: 'failed', attempts: { increment: 1 }, lastError: error, claimToken: null, claimedAt: null }); }
  private async updateDispatch(backfillId: string, claimToken: string, data: Parameters<DatabaseClient['backfillEvent']['updateMany']>[0]['data']) {
    if (!claimToken) throw new OwnershipLostError(backfillId);
    const result = await this.db.backfillEvent.updateMany({ where: { id: backfillId, claimToken, dispatchStatus: 'processing' }, data });
    if (result.count === 0) throw new OwnershipLostError(backfillId);
    if (result.count !== 1) throw new DispatchStateConsistencyError(backfillId, result.count);
  }
}

function reportContainsBusinessDate(periodStart: Date, periodEnd: Date, businessDate: string) {
  const start = new Date(`${businessDate}T00:00:00+08:00`);
  const end = new Date(`${businessDate}T23:59:59.999+08:00`);
  return periodStart <= end && periodEnd >= start;
}

export class ReportRebuildDispatcher {
  constructor(private readonly store: AffectedReportStore, private readonly queue: Queue<ReportJobData>, private readonly logError: (entry: unknown) => void = (entry) => console.error(JSON.stringify(entry))) {}

  async handle(event: ClaimedBackfillEvent) {
    try {
      for (const report of await this.store.findAffectedReports(event)) {
        const scope = `${event.backfillId}\0${report.accountId}\0${report.type}\0${report.periodStart.toISOString()}\0${report.periodEnd.toISOString()}`;
        const jobId = `report-rebuild-${createHash('sha256').update(scope).digest('hex').slice(0, 32)}`;
        await this.queue.add('rebuild-report', {
        type: report.type,
        now: new Date(report.periodEnd.getTime() + 1).toISOString(),
        accountId: report.accountId,
        backfillId: event.backfillId,
        previousReportId: report.id,
        rebuildReason: event.reason,
        }, reportJobOptions(jobId));
      }
      await this.store.markDispatched?.(event.backfillId, event.claimToken);
    } catch (error) {
      if (error instanceof OwnershipLostError) throw error;
      await this.store.markDispatchFailed?.(event.backfillId, error instanceof Error ? error.message : String(error), event.claimToken);
    }
  }

  async dispatchPending() {
    let events: ClaimedBackfillEvent[];
    try { events = await this.store.claimPendingEvents?.(randomUUID(), new Date()) ?? []; }
    catch (error) { this.logError(outboxError('claim_failed', error)); return; }
    for (const event of events) {
      try { await this.handle(event); }
      catch (error) { this.logError({ ...outboxError(error instanceof OwnershipLostError ? 'claim_lost' : 'outbox_event_failed', error), backfillId: event.backfillId }); }
    }
  }
}

export function startReportScheduler(queue: Queue<ReportJobData>, dispatcher?: ReportRebuildDispatcher) {
  void runScheduledReportTick(queue);
  void dispatcher?.dispatchPending();
  const timer = setInterval(() => { void runScheduledReportTick(queue); void dispatcher?.dispatchPending(); }, 60_000);
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

function outboxError(event: string, error: unknown) {
  return { service: 'worker', component: 'report-rebuild-outbox', event, error: error instanceof Error ? error.message : String(error) };
}

function shanghaiParts(now: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, day: Number(parts.day), weekday: parts.weekday };
}
