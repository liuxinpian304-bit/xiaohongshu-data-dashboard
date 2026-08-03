import type { DatabaseClient } from '@xhs/database';
import { getRollingSyncDates, rollingSyncJobId, type RollingSyncMode } from '@xhs/domain';
import type { JobsOptions } from 'bullmq';
import { fromZonedTime } from 'date-fns-tz';

import { SYNC_ACCOUNT_QUEUE } from '../queues';

const ACCOUNT_PAGE_SIZE = 100;
const MAX_ACCOUNT_PAGES = 10_000;
const ENQUEUE_CONCURRENCY = 16;
const BUSINESS_TIME_ZONE = 'Asia/Shanghai';

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
  hasMore: boolean;
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
    const rows = await this.db.account.findMany({
      where: {
        connectorType: 'official',
        revocationState: 'none',
        ...(cursor ? { id: { gt: cursor } } : {}),
        credentials: { some: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
        AND: [
          { capabilities: { some: { capability: 'notes', enabled: true } } },
          { capabilities: { some: { capability: 'noteMetrics', enabled: true } } },
        ],
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
      select: { id: true },
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    return { items, hasMore, nextCursor: hasMore ? items.at(-1)?.id : undefined };
  }
}

export async function enqueueRollingSyncTick(
  queue: RollingSyncQueue,
  accounts: RollingSyncAccountStore,
  now = new Date(),
  logError: (entry: unknown) => void = (entry) => console.error(JSON.stringify(entry)),
): Promise<void> {
  const window = getRollingSyncDates(now);
  const seenAccounts = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < MAX_ACCOUNT_PAGES; pageNumber += 1) {
    const page = await accounts.listOfficialAccounts(cursor, ACCOUNT_PAGE_SIZE, now);
    validatePage(page, cursor, seenAccounts, seenCursors);

    const jobs = page.items.flatMap(({ id: accountId }) => window.dates.map((businessDate) => ({ accountId, businessDate })));
    await mapWithConcurrency(jobs, ENQUEUE_CONCURRENCY, async ({ accountId, businessDate }) => {
      const jobId = rollingSyncJobId(accountId, businessDate, window.mode);
      try {
        await queue.add(
          SYNC_ACCOUNT_QUEUE,
          rollingSyncJobData(accountId, businessDate, window.mode),
          rollingSyncJobOptions(accountId, businessDate, window.mode),
        );
      } catch (error) {
        logError({
          service: 'worker', component: 'rolling-sync-scheduler', event: 'job_enqueue_failed', accountId, businessDate, jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    for (const account of page.items) seenAccounts.add(account.id);
    if (!page.hasMore) return;
    seenCursors.add(page.nextCursor!);
    cursor = page.nextCursor;
  }

  throw new Error(`account pagination exceeded ${MAX_ACCOUNT_PAGES} pages`);
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
  const start = fromZonedTime(`${businessDate}T00:00:00`, BUSINESS_TIME_ZONE);
  const end = fromZonedTime(`${nextGregorianDate(businessDate)}T00:00:00`, BUSINESS_TIME_ZONE);
  return {
    accountId,
    businessDate,
    windowStart: start.toISOString(),
    windowEndExclusive: end.toISOString(),
    mode,
    source: 'official',
  };
}

function validatePage(page: RollingSyncAccountPage, cursor: string | undefined, seenAccounts: Set<string>, seenCursors: Set<string>): void {
  if (page.hasMore && page.nextCursor && (page.nextCursor === cursor || seenCursors.has(page.nextCursor))) {
    throw new Error(`account pagination cursor loop at ${page.nextCursor}`);
  }
  const pageAccounts = new Set<string>();
  for (const account of page.items) {
    if (seenAccounts.has(account.id) || pageAccounts.has(account.id)) throw new Error(`account pagination repeated account ${account.id}`);
    pageAccounts.add(account.id);
  }
  if (!page.hasMore) {
    if (page.nextCursor) throw new Error(`account pagination supplied cursor ${page.nextCursor} without more results`);
    return;
  }
  if (!page.items.length || !page.nextCursor) throw new Error('account pagination reported more results without a cursor');
  if (page.items.at(-1)?.id !== page.nextCursor) throw new Error(`account pagination cursor ${page.nextCursor} does not match the last account`);
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, operation: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      if (item !== undefined) await operation(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

function nextGregorianDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}
