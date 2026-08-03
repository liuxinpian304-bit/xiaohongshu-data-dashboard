import type { DatabaseClient } from '@xhs/database';
import { getRollingSyncDates, rollingSyncJobId, type RollingSyncMode } from '@xhs/domain';
import type { JobsOptions } from 'bullmq';

import { SYNC_ACCOUNT_QUEUE } from '../queues';

const ACCOUNT_PAGE_SIZE = 100;
const MAX_ACCOUNT_PAGES = 10_000;

export interface RollingSyncJobData {
  accountId: string;
  businessDate: string;
  windowStart: string;
  windowEndExclusive: string;
  mode: RollingSyncMode;
  source: 'official';
}

export interface RollingSyncAccountPage {
  items: Array<{ id: string }>;
  nextCursor?: string;
}

export interface RollingSyncAccountStore {
  listOfficialAccounts(cursor: string | undefined, limit: number, now: Date): Promise<RollingSyncAccountPage>;
}

interface RollingSyncQueue {
  add(name: string, data: RollingSyncJobData, options: JobsOptions): Promise<unknown>;
}

export class PrismaRollingSyncAccountStore implements RollingSyncAccountStore {
  constructor(private readonly db: DatabaseClient) {}

  async listOfficialAccounts(cursor: string | undefined, limit: number, now: Date): Promise<RollingSyncAccountPage> {
    const items = await this.db.account.findMany({
      where: {
        connectorType: 'official',
        ...(cursor ? { id: { gt: cursor } } : {}),
        credentials: { some: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
        capabilities: { some: { enabled: true } },
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true },
    });
    return { items, nextCursor: items.length === limit ? items.at(-1)?.id : undefined };
  }
}

export async function enqueueRollingSyncTick(
  queue: RollingSyncQueue,
  accounts: RollingSyncAccountStore,
  now = new Date(),
  logError: (entry: unknown) => void = (entry) => console.error(JSON.stringify(entry)),
): Promise<void> {
  const accountIds = await loadAllOfficialAccountIds(accounts, now);
  const window = getRollingSyncDates(now);

  for (const accountId of accountIds) {
    try {
      for (const businessDate of window.dates) {
        await queue.add(
          SYNC_ACCOUNT_QUEUE,
          rollingSyncJobData(accountId, businessDate, window.mode),
          rollingSyncJobOptions(accountId, businessDate, window.mode),
        );
      }
    } catch (error) {
      logError({
        service: 'worker', component: 'rolling-sync-scheduler', event: 'account_enqueue_failed', accountId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function rollingSyncJobOptions(accountId: string, businessDate: string, mode: RollingSyncMode): JobsOptions {
  return {
    jobId: rollingSyncJobId(accountId, businessDate, mode),
    attempts: 6,
    backoff: { type: 'exponential', delay: 1_000, jitter: 0.5 },
    removeOnComplete: { age: 35 * 24 * 60 * 60 },
  };
}

function rollingSyncJobData(accountId: string, businessDate: string, mode: RollingSyncMode): RollingSyncJobData {
  const start = new Date(`${businessDate}T00:00:00+08:00`);
  return {
    accountId,
    businessDate,
    windowStart: start.toISOString(),
    windowEndExclusive: new Date(start.getTime() + 24 * 60 * 60_000).toISOString(),
    mode,
    source: 'official',
  };
}

async function loadAllOfficialAccountIds(store: RollingSyncAccountStore, now: Date): Promise<string[]> {
  const accountIds: string[] = [];
  const seenAccounts = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < MAX_ACCOUNT_PAGES; pageNumber += 1) {
    const page = await store.listOfficialAccounts(cursor, ACCOUNT_PAGE_SIZE, now);
    for (const account of page.items) {
      if (seenAccounts.has(account.id)) throw new Error(`account pagination repeated account ${account.id}`);
      seenAccounts.add(account.id);
      accountIds.push(account.id);
    }
    if (!page.nextCursor) return accountIds;
    if (page.items.at(-1)?.id !== page.nextCursor) throw new Error(`account pagination cursor ${page.nextCursor} does not match the last account`);
    if (page.nextCursor === cursor || seenCursors.has(page.nextCursor)) throw new Error(`account pagination cursor loop at ${page.nextCursor}`);
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  throw new Error(`account pagination exceeded ${MAX_ACCOUNT_PAGES} pages`);
}
