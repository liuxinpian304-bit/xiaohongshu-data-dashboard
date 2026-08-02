import { UnrecoverableError, Worker, type Job } from 'bullmq';

import { SYNC_ACCOUNT_QUEUE, redisConnection } from '../queues';
import type { SyncResult, SyncService } from './sync.service';

export interface SyncAccountJobData { accountId: string }

export async function processSyncAccountJob(service: SyncService, job: Job<SyncAccountJobData>): Promise<SyncResult> {
  try {
    return await service.runAccountSync(job.id ?? job.name, job.data.accountId);
  } catch (error) {
    const status = httpStatus(error);
    if (status === 401 || status === 403) {
      throw new UnrecoverableError(error instanceof Error ? error.message : `HTTP ${status}`);
    }
    throw error;
  }
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
