import type { DatabaseClient } from '@xhs/database';
import type { JobsOptions } from 'bullmq';

import { SYNC_ACCOUNT_QUEUE } from '../queues';

interface PendingSyncStore {
  findPending(): Promise<Array<{ id: string; accountId: string }>>;
}

interface PendingSyncQueue {
  add(name: string, data: { accountId: string }, options: JobsOptions): Promise<unknown>;
}

export class PrismaPendingSyncStore implements PendingSyncStore {
  constructor(private readonly db: DatabaseClient) {}

  findPending() {
    return this.db.syncJob.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true, accountId: true },
    });
  }
}

export async function dispatchPendingSyncJobs(store: PendingSyncStore, queue: PendingSyncQueue) {
  const pending = await store.findPending();
  await Promise.all(pending.map((job) => queue.add(
    SYNC_ACCOUNT_QUEUE,
    { accountId: job.accountId },
    { jobId: job.id, attempts: 6, backoff: { type: 'exponential', delay: 1_000, jitter: 0.5 }, removeOnComplete: true },
  )));
}

export function startPendingSyncDispatcher(store: PendingSyncStore, queue: PendingSyncQueue, intervalMs = 1_000) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await dispatchPendingSyncJobs(store, queue); }
    catch (error) { console.error(JSON.stringify({ service: 'worker', component: 'pending-sync-dispatcher', event: 'dispatch_failed', error: error instanceof Error ? error.message : String(error) })); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return { close: () => clearInterval(timer) };
}
