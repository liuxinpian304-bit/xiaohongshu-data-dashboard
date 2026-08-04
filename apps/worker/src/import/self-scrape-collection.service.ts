import { createHash } from 'node:crypto';

import type { DatabaseClient } from '@xhs/database';
import { normalizeCollectionEvent, type NormalizedSelfScrapeRecord, type SelfScrapeCollectionEventV1 } from '@xhs/self-scrape-import';

import { commitRecord } from './self-scrape-import.service';

export interface SelfScrapeCollectionOptions { db: DatabaseClient; runId: string; accountPlatformId: string }
export interface SelfScrapeCollectionSummary { accountId: string; notesChanged: number; snapshotsChanged: number; commentsChanged: number; incompleteNotes: number; sha256: string }

export async function importSelfScrapeCollection(input: Iterable<unknown>, options: SelfScrapeCollectionOptions): Promise<SelfScrapeCollectionSummary> {
  const events = [...input].map(normalizeCollectionEvent);
  if (events.some((event) => event.runId !== options.runId)) throw new Error('collection_run_mismatch');
  if (!events.some((event) => event.type === 'completed')) throw new Error('collection_not_completed');
  const noteEvents = events.filter((event): event is Extract<SelfScrapeCollectionEventV1, { type: 'note' }> => event.type === 'note');
  const metricEvents = events.filter((event): event is Extract<SelfScrapeCollectionEventV1, { type: 'metric' }> => event.type === 'metric');
  const records = noteEvents.map((event) => collectionRecord(event, metricEvents.filter(({ metric }) => metric.noteId === event.note.platformId)));
  let notesChanged = 0; let snapshotsChanged = 0;
  for (const record of records) {
    const result = await commitRecord(options.db, options.accountPlatformId, record, options.runId);
    notesChanged += result.noteChanged ? 1 : 0;
    snapshotsChanged += result.snapshotsChanged;
  }
  const account = await options.db.account.upsert({
    where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: options.accountPlatformId } },
    create: { connectorType: 'self-scrape', platformId: options.accountPlatformId }, update: {},
  });
  let commentsChanged = 0;
  for (const event of events) {
    if (event.type !== 'comment') continue;
    const note = await options.db.note.findUniqueOrThrow({ where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: event.comment.noteId } } });
    if (note.accountId !== account.id) throw new Error('collection_comment_account_mismatch');
    const existing = await options.db.comment.findUnique({ where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: event.comment.platformId } } });
    const changed = !existing || existing.noteId !== note.id || existing.parentPlatformId !== event.comment.parentPlatformId || existing.content !== event.comment.content || existing.publishedAt.toISOString() !== event.comment.publishedAt || existing.likeCount !== event.comment.likeCount;
    await options.db.comment.upsert({
      where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: event.comment.platformId } },
      create: { noteId: note.id, connectorType: 'self-scrape', platformId: event.comment.platformId, parentPlatformId: event.comment.parentPlatformId, content: event.comment.content, publishedAt: new Date(event.comment.publishedAt), likeCount: event.comment.likeCount, source: 'self-scrape' },
      update: { noteId: note.id, parentPlatformId: event.comment.parentPlatformId, content: event.comment.content, publishedAt: new Date(event.comment.publishedAt), likeCount: event.comment.likeCount, lastSeenAt: new Date(), source: 'self-scrape' },
    });
    commentsChanged += changed ? 1 : 0;
  }
  let incompleteNotes = 0;
  const completeness = new Map(events.filter((event): event is Extract<SelfScrapeCollectionEventV1, { type: 'completeness' }> => event.type === 'completeness').map((event) => [event.noteId, event]));
  for (const note of noteEvents) {
    const terminal = completeness.get(note.note.platformId);
    const status = terminal?.status ?? 'unverifiable';
    if (status !== 'page_complete') incompleteNotes += 1;
    await options.db.commentSyncCompleteness.upsert({
      where: { connectorType_accountId_notePlatformId: { connectorType: 'self-scrape', accountId: account.id, notePlatformId: note.note.platformId } },
      create: { connectorType: 'self-scrape', accountId: account.id, notePlatformId: note.note.platformId, status, cursor: null, error: status === 'page_complete' ? null : terminal?.reason ?? 'missing_terminal_event' },
      update: { status, cursor: null, error: status === 'page_complete' ? null : terminal?.reason ?? 'missing_terminal_event' },
    });
  }
  const sha256 = createHash('sha256').update(events.map((event) => JSON.stringify(event)).join('\n')).digest('hex');
  return { accountId: account.id, notesChanged, snapshotsChanged, commentsChanged, incompleteNotes, sha256 };
}

function collectionRecord(note: Extract<SelfScrapeCollectionEventV1, { type: 'note' }>, metrics: Array<Extract<SelfScrapeCollectionEventV1, { type: 'metric' }>>): NormalizedSelfScrapeRecord {
  const byKey = new Map(metrics.map((event) => [event.metric.key, event.metric]));
  if (byKey.size !== 3 || !byKey.has('views') || !byKey.has('likes') || !byKey.has('comments')) throw new Error('collection_metrics_incomplete');
  const captured = new Set(metrics.map((event) => event.metric.capturedAt));
  if (captured.size !== 1) throw new Error('collection_metric_timestamp_mismatch');
  return {
    note: { connectorType: 'self-scrape', platformId: note.note.platformId, inputAccountId: '', title: note.note.title, publishedAt: note.note.publishedAt },
    metrics: (['views', 'likes', 'comments'] as const).map((key) => {
      const metric = byKey.get(key)!;
      return { key, availability: metric.availability, value: metric.value, capturedAt: metric.capturedAt, source: 'self-scrape', aggregation: 'cumulative_delta', aggregationVersion: 'jsonl-v1', authoritativePeriod: false, windowStart: null, windowEnd: null };
    }),
  };
}
