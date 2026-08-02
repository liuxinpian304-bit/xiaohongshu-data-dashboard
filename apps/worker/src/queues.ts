import { Queue, type JobsOptions } from 'bullmq';

export const SYNC_ACCOUNT_QUEUE = 'sync-account';

export function accountSyncJobId(accountId: string, businessDate: string) {
  return `sync:${accountId}:${businessDate}`;
}

export function syncAccountJobOptions(accountId: string, businessDate: string): JobsOptions {
  return {
    jobId: accountSyncJobId(accountId, businessDate),
    attempts: 6,
    backoff: { type: 'exponential', delay: 1_000, jitter: 0.5 },
    removeOnComplete: true,
  };
}

export function createSyncAccountQueue(connection = redisConnection()) {
  return new Queue<{ accountId: string }>(SYNC_ACCOUNT_QUEUE, { connection });
}

export function enqueueAccountSync(queue: Queue<{ accountId: string }>, accountId: string, businessDate: string) {
  return queue.add(SYNC_ACCOUNT_QUEUE, { accountId }, syncAccountJobOptions(accountId, businessDate));
}

export function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return { host: url.hostname, port: Number(url.port || 6379), password: url.password || undefined };
}
