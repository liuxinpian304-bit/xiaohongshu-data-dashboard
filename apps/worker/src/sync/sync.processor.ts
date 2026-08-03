import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { fromZonedTime } from 'date-fns-tz';

import { SYNC_ACCOUNT_QUEUE, redisConnection } from '../queues';
import type { RollingSyncContext, SyncResult, SyncService } from './sync.service';

export interface SyncAccountJobData { accountId: string; businessDate?: string; windowStart?: string; windowEndExclusive?: string; mode?: RollingSyncContext['mode']; source?: 'official' }

export async function processSyncAccountJob(service: SyncService, job: Job<SyncAccountJobData>): Promise<SyncResult> {
  try {
    return await service.runAccountSync(job.id ?? job.name, job.data.accountId, rollingContext(job.data));
  } catch (error) {
    const status = httpStatus(error);
    if (status === 401 || status === 403) {
      throw new UnrecoverableError(error instanceof Error ? error.message : `HTTP ${status}`);
    }
    throw error;
  }
}

function rollingContext(data: SyncAccountJobData): RollingSyncContext | undefined {
  if (!data.businessDate && !data.windowStart && !data.windowEndExclusive && !data.mode && !data.source) return undefined;
  if (!data.businessDate || !data.windowStart || !data.windowEndExclusive || (data.mode !== 'month_to_date' && data.mode !== 'previous_month_final') || data.source !== 'official') throw new Error('rolling sync payload is incomplete or non-official');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data.businessDate);
  const canonicalDate = match && new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).toISOString().slice(0, 10);
  const start = new Date(data.windowStart); const end = new Date(data.windowEndExclusive);
  const expectedStart = fromZonedTime(`${data.businessDate}T00:00:00`, 'Asia/Shanghai');
  const nextDate = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1)).toISOString().slice(0, 10) : '';
  const expectedEnd = fromZonedTime(`${nextDate}T00:00:00`, 'Asia/Shanghai');
  if (canonicalDate !== data.businessDate || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || start.getTime() !== expectedStart.getTime() || end.getTime() !== expectedEnd.getTime()) throw new Error('rolling sync payload has an invalid Shanghai business-day window');
  return { businessDate: data.businessDate, windowStart: start.toISOString(), windowEndExclusive: end.toISOString(), mode: data.mode, source: data.source };
}

export function createSyncWorker(service: SyncService) {
  return new Worker<SyncAccountJobData>(
    SYNC_ACCOUNT_QUEUE,
    (job) => processSyncAccountJob(service, job),
    { connection: redisConnection(), concurrency: Number(process.env.SYNC_CONCURRENCY ?? 4) },
  );
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('status' in error && typeof error.status === 'number') return error.status;
  if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode;
  if ('response' in error && typeof error.response === 'object' && error.response !== null && 'status' in error.response && typeof error.response.status === 'number') return error.response.status;
  return undefined;
}
