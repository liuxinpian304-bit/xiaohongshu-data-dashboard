import { createHash } from 'node:crypto';

import type { ObservationSource, Platform, PlatformCollectionEventV2, PlatformMetricKey } from '@xhs/domain';
import { normalizePlatformCollectionEvent } from '@xhs/self-scrape-import';

import type { DatabaseClient, TransactionClient } from './client';

export interface PlatformCollectionOptions {
  db: DatabaseClient;
  runId: string;
  platform: Platform;
  accountPlatformId: string;
  source: ObservationSource;
}

export interface PlatformImportSummary {
  accountId: string;
  platform: Platform;
  source: ObservationSource;
  contentsChanged: number;
  snapshotsChanged: number;
  commentsChanged: number;
  incompleteContents: number;
  sha256: string;
}

const metricNames: Record<PlatformMetricKey, string> = {
  views: '播放/阅读', likes: '点赞', comments: '评论', favorites: '收藏', shares: '分享', followers: '粉丝',
};

export async function importPlatformCollection(input: Iterable<unknown>, options: PlatformCollectionOptions): Promise<PlatformImportSummary> {
  const events = [...input].map(normalizePlatformCollectionEvent);
  validateEnvelope(events, options);
  const sha256 = createHash('sha256').update(events.map((event) => JSON.stringify(event)).join('\n')).digest('hex');

  return options.db.$transaction(async (db) => importTransaction(events, { ...options, db, sha256 }));
}

async function importTransaction(events: PlatformCollectionEventV2[], options: Omit<PlatformCollectionOptions, 'db'> & { db: TransactionClient; sha256: string }): Promise<PlatformImportSummary> {
  const { db, platform, source, runId } = options;
  const connectorType = source;
  const aggregationVersion = source === 'self-scrape' ? 'jsonl-v1' : 'platform-jsonl-v2';
  const accountEvent = events.find((event): event is Extract<PlatformCollectionEventV2, { type: 'account' }> => event.type === 'account');
  if (accountEvent && accountEvent.account.platformId !== options.accountPlatformId) throw new Error('collection_account_mismatch');

  const oldAccount = await db.account.findFirst({ where: { platform, platformId: options.accountPlatformId } });
  const accountData = accountEvent?.account;
  const account = oldAccount
    ? await db.account.update({ where: { id: oldAccount.id }, data: { source, connectorType, displayName: accountData?.displayName ?? oldAccount.displayName, avatarUrl: accountData?.avatarUrl ?? oldAccount.avatarUrl } })
    : await db.account.create({ data: { platform, source, connectorType, platformId: options.accountPlatformId, displayName: accountData?.displayName, avatarUrl: accountData?.avatarUrl } });

  const contents = events.filter((event): event is Extract<PlatformCollectionEventV2, { type: 'content' }> => event.type === 'content');
  const metrics = events.filter((event): event is Extract<PlatformCollectionEventV2, { type: 'metric' }> => event.type === 'metric');
  let contentsChanged = 0;
  let snapshotsChanged = 0;
  let commentsChanged = 0;

  for (const event of contents) {
    const existing = await db.note.findFirst({ where: { platform, platformId: event.content.platformId } });
    if (existing && existing.accountId !== account.id) throw new Error('collection_content_account_mismatch');
    const changed = !existing || existing.title !== event.content.title || existing.contentKind !== event.content.contentKind || existing.publishedAt.toISOString() !== event.content.publishedAt;
    const note = existing
      ? await db.note.update({ where: { id: existing.id }, data: changed ? { title: event.content.title, contentKind: event.content.contentKind, publishedAt: new Date(event.content.publishedAt), lastSeenAt: new Date(), source, connectorType } : {} })
      : await db.note.create({ data: { accountId: account.id, platform, source, contentKind: event.content.contentKind, connectorType, platformId: event.content.platformId, title: event.content.title, publishedAt: new Date(event.content.publishedAt) } });
    contentsChanged += changed ? 1 : 0;

    let contentSnapshotsChanged = 0;
    const contentMetrics = metrics.filter(({ metric }) => metric.contentId === event.content.platformId);
    for (const { metric } of contentMetrics) {
      const definition = await db.metricDefinition.upsert({
        where: { platform_key_source_version: { platform, key: metric.key, source, version: aggregationVersion } },
        create: { platform, key: metric.key, displayName: metricNames[metric.key], unit: 'count', aggregation: 'cumulative_delta', source, version: aggregationVersion, effectiveFrom: new Date(0) },
        update: {},
      });
      const capturedAt = new Date(metric.capturedAt);
      const current = await db.metricSnapshot.findFirst({ where: { noteId: note.id, metricDefinitionId: definition.id, capturedAt, supersededAt: null } });
      const exact = current && current.availability === metric.availability && current.value?.toString() === (metric.value === null ? undefined : String(metric.value));
      if (exact) continue;
      if (current) {
        const correctedAt = new Date();
        await db.$executeRaw`SELECT supersede_metric_snapshot(${current.id}::uuid, ${correctedAt}::timestamptz)`;
        await db.metricSnapshot.create({ data: { noteId: note.id, metricDefinitionId: definition.id, availability: metric.availability, value: metric.value, capturedAt, observedAt: capturedAt, source, aggregation: 'cumulative_delta', aggregationVersion, authoritativePeriod: false, revision: current.revision + 1, supersedesId: current.id, correctedAt, correctionReason: 'changed_platform_observation', sourceRunId: runId } });
      } else {
        await db.metricSnapshot.create({ data: { noteId: note.id, metricDefinitionId: definition.id, availability: metric.availability, value: metric.value, capturedAt, observedAt: capturedAt, source, aggregation: 'cumulative_delta', aggregationVersion, authoritativePeriod: false, sourceRunId: runId } });
      }
      snapshotsChanged += 1;
      contentSnapshotsChanged += 1;
    }
    if (contentSnapshotsChanged > 0 && contentMetrics[0]) {
      const capturedAt = contentMetrics[0].metric.capturedAt;
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(capturedAt));
      const id = createHash('sha256').update(`${note.id}\0${capturedAt}\0${runId}`).digest('hex').slice(0, 32);
      await db.backfillEvent.upsert({ where: { id }, create: { id, accountId: account.id, noteId: note.id, capturedDates: [date], reason: 'platform_observation_committed', source, businessDate: date }, update: {} });
    }
  }

  for (const event of events) if (event.type === 'comment') {
    const note = await db.note.findFirstOrThrow({ where: { platform, platformId: event.comment.contentId } });
    if (note.accountId !== account.id) throw new Error('collection_comment_account_mismatch');
    const old = await db.comment.findFirst({ where: { platform, platformId: event.comment.platformId } });
    const changed = !old || old.noteId !== note.id || old.parentPlatformId !== event.comment.parentPlatformId || old.content !== event.comment.content || old.publishedAt.toISOString() !== event.comment.publishedAt || old.likeCount !== event.comment.likeCount;
    if (old) await db.comment.update({ where: { id: old.id }, data: { noteId: note.id, connectorType, parentPlatformId: event.comment.parentPlatformId, content: event.comment.content, publishedAt: new Date(event.comment.publishedAt), likeCount: event.comment.likeCount, lastSeenAt: new Date(), source } });
    else await db.comment.create({ data: { noteId: note.id, platform, connectorType, platformId: event.comment.platformId, parentPlatformId: event.comment.parentPlatformId, content: event.comment.content, publishedAt: new Date(event.comment.publishedAt), likeCount: event.comment.likeCount, source } });
    commentsChanged += changed ? 1 : 0;
  }

  const completeness = events.filter((event): event is Extract<PlatformCollectionEventV2, { type: 'completeness' }> => event.type === 'completeness');
  let incompleteContents = 0;
  for (const event of contents) {
    const ends = completeness.filter(({ contentId }) => contentId === event.content.platformId);
    const complete = (['comments', 'replies'] as const).every((scope) => ends.some((item) => item.scope === scope && item.status === 'complete' && item.reason === 'platform_end'));
    if (!complete) incompleteContents += 1;
    const errors = ends.filter((item) => item.status !== 'complete').map((item) => `${item.scope}:${item.reason}`);
    await db.commentSyncCompleteness.upsert({
      where: { connectorType_accountId_notePlatformId: { connectorType, accountId: account.id, notePlatformId: event.content.platformId } },
      create: { connectorType, accountId: account.id, notePlatformId: event.content.platformId, status: complete ? 'page_complete' : 'unverifiable', cursor: null, error: complete ? null : errors.join(',') || 'missing_terminal_event' },
      update: { status: complete ? 'page_complete' : 'unverifiable', cursor: null, error: complete ? null : errors.join(',') || 'missing_terminal_event' },
    });
  }

  return { accountId: account.id, platform, source, contentsChanged, snapshotsChanged, commentsChanged, incompleteContents, sha256: options.sha256 };
}

function validateEnvelope(events: PlatformCollectionEventV2[], options: PlatformCollectionOptions) {
  if (events.some((event) => event.runId !== options.runId)) throw new Error('collection_run_mismatch');
  if (events.some((event) => event.platform !== options.platform)) throw new Error('collection_platform_mismatch');
  if (events.some((event) => event.source !== options.source)) throw new Error('collection_source_mismatch');
  if (!events.some((event) => event.type === 'completed')) throw new Error('collection_not_completed');
  const contentIds = new Set(events.filter((event): event is Extract<PlatformCollectionEventV2, { type: 'content' }> => event.type === 'content').map((event) => event.content.platformId));
  for (const event of events) {
    if (event.type === 'metric' && !contentIds.has(event.metric.contentId)) throw new Error('collection_metric_content_mismatch');
    if (event.type === 'comment' && !contentIds.has(event.comment.contentId)) throw new Error('collection_comment_content_mismatch');
  }
}
