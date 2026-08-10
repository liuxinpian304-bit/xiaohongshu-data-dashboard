import { createHash } from 'node:crypto';
import { normalizeCollectionEvent, type SelfScrapeCollectionEventV1 } from '@xhs/self-scrape-import';
import type { DatabaseClient } from './client';

export interface SelfScrapeCollectionOptions { db: DatabaseClient; runId: string; accountPlatformId: string }
export interface SelfScrapeCollectionSummary { accountId: string; notesChanged: number; snapshotsChanged: number; commentsChanged: number; incompleteNotes: number; sha256: string }
const definitions = { views: '阅读量', likes: '点赞', comments: '评论' } as const;

export async function importSelfScrapeCollection(input: Iterable<unknown>, options: SelfScrapeCollectionOptions): Promise<SelfScrapeCollectionSummary> {
  const events = [...input].map(normalizeCollectionEvent);
  if (events.some(({ runId }) => runId !== options.runId)) throw new Error('collection_run_mismatch');
  if (!events.some(({ type }) => type === 'completed')) throw new Error('collection_not_completed');
  const notes = events.filter((event): event is Extract<SelfScrapeCollectionEventV1, { type: 'note' }> => event.type === 'note');
  const metrics = events.filter((event): event is Extract<SelfScrapeCollectionEventV1, { type: 'metric' }> => event.type === 'metric');
  validateMetrics(notes, metrics);
  const account = await options.db.account.upsert({ where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: options.accountPlatformId } }, create: { connectorType: 'self-scrape', platformId: options.accountPlatformId }, update: {} });
  let notesChanged = 0; let snapshotsChanged = 0; let commentsChanged = 0;
  for (const event of notes) {
    const existing = await options.db.note.findUnique({ where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: event.note.platformId } } });
    if (existing && existing.accountId !== account.id) throw new Error('collection_note_account_mismatch');
    const changed = !existing || existing.title !== event.note.title || existing.publishedAt.toISOString() !== event.note.publishedAt;
    const note = await options.db.note.upsert({ where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: event.note.platformId } }, create: { accountId: account.id, connectorType: 'self-scrape', platformId: event.note.platformId, title: event.note.title, publishedAt: new Date(event.note.publishedAt) }, update: changed ? { title: event.note.title, publishedAt: new Date(event.note.publishedAt), lastSeenAt: new Date() } : {} });
    notesChanged += changed ? 1 : 0;
    const noteMetrics = metrics.filter(({ metric }) => metric.noteId === event.note.platformId);
    for (const metricEvent of noteMetrics) {
      const metric = metricEvent.metric; const displayName = definitions[metric.key];
      const definition = await options.db.metricDefinition.upsert({ where: { platform_key_source_version: { platform: 'xiaohongshu', key: metric.key, source: 'self-scrape', version: 'jsonl-v1' } }, create: { platform: 'xiaohongshu', key: metric.key, displayName, unit: 'count', aggregation: 'cumulative_delta', source: 'self-scrape', version: 'jsonl-v1', effectiveFrom: new Date(0) }, update: {} });
      const capturedAt = new Date(metric.capturedAt);
      const current = await options.db.metricSnapshot.findFirst({ where: { noteId: note.id, metricDefinitionId: definition.id, capturedAt, supersededAt: null } });
      const exact = current && current.availability === metric.availability && current.value?.toString() === (metric.value === null ? undefined : String(metric.value));
      if (exact) continue;
      if (current) {
        const correctedAt = new Date();
        await options.db.$executeRaw`SELECT supersede_metric_snapshot(${current.id}::uuid, ${correctedAt}::timestamptz)`;
        await options.db.metricSnapshot.create({ data: { noteId: note.id, metricDefinitionId: definition.id, availability: metric.availability, value: metric.value, capturedAt, observedAt: capturedAt, source: 'self-scrape', aggregation: 'cumulative_delta', aggregationVersion: 'jsonl-v1', authoritativePeriod: false, revision: current.revision + 1, supersedesId: current.id, correctedAt, correctionReason: 'changed_self_scrape_observation', sourceRunId: options.runId } });
      } else await options.db.metricSnapshot.create({ data: { noteId: note.id, metricDefinitionId: definition.id, availability: metric.availability, value: metric.value, capturedAt, observedAt: capturedAt, source: 'self-scrape', aggregation: 'cumulative_delta', aggregationVersion: 'jsonl-v1', authoritativePeriod: false, sourceRunId: options.runId } });
      snapshotsChanged += 1;
    }
    if (noteMetrics.length && snapshotsChanged) {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(noteMetrics[0]!.metric.capturedAt));
      const id = createHash('sha256').update(`${note.id}\0${noteMetrics[0]!.metric.capturedAt}\0${options.runId}`).digest('hex').slice(0, 32);
      await options.db.backfillEvent.upsert({ where: { id }, create: { id, accountId: account.id, noteId: note.id, capturedDates: [date], reason: 'self_scrape_observation_committed', source: 'self-scrape', businessDate: date }, update: {} });
    }
  }
  for (const event of events) if (event.type === 'comment') {
    const note = await options.db.note.findUniqueOrThrow({ where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: event.comment.noteId } } });
    if (note.accountId !== account.id) throw new Error('collection_comment_account_mismatch');
    const old = await options.db.comment.findUnique({ where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: event.comment.platformId } } });
    const changed = !old || old.noteId !== note.id || old.parentPlatformId !== event.comment.parentPlatformId || old.content !== event.comment.content || old.publishedAt.toISOString() !== event.comment.publishedAt || old.likeCount !== event.comment.likeCount;
    await options.db.comment.upsert({ where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: event.comment.platformId } }, create: { noteId: note.id, connectorType: 'self-scrape', platformId: event.comment.platformId, parentPlatformId: event.comment.parentPlatformId, content: event.comment.content, publishedAt: new Date(event.comment.publishedAt), likeCount: event.comment.likeCount, source: 'self-scrape' }, update: { noteId: note.id, parentPlatformId: event.comment.parentPlatformId, content: event.comment.content, publishedAt: new Date(event.comment.publishedAt), likeCount: event.comment.likeCount, lastSeenAt: new Date(), source: 'self-scrape' } });
    commentsChanged += changed ? 1 : 0;
  }
  const terminal = new Map(events.filter((event): event is Extract<SelfScrapeCollectionEventV1, { type: 'completeness' }> => event.type === 'completeness').map((event) => [event.noteId, event]));
  let incompleteNotes = 0;
  for (const event of notes) {
    const end = terminal.get(event.note.platformId); const status = end?.status ?? 'unverifiable'; if (status !== 'page_complete') incompleteNotes += 1;
    await options.db.commentSyncCompleteness.upsert({ where: { connectorType_accountId_notePlatformId: { connectorType: 'self-scrape', accountId: account.id, notePlatformId: event.note.platformId } }, create: { connectorType: 'self-scrape', accountId: account.id, notePlatformId: event.note.platformId, status, cursor: null, error: status === 'page_complete' ? null : end?.reason ?? 'missing_terminal_event' }, update: { status, cursor: null, error: status === 'page_complete' ? null : end?.reason ?? 'missing_terminal_event' } });
  }
  return { accountId: account.id, notesChanged, snapshotsChanged, commentsChanged, incompleteNotes, sha256: createHash('sha256').update(events.map((event) => JSON.stringify(event)).join('\n')).digest('hex') };
}

function validateMetrics(notes: Array<Extract<SelfScrapeCollectionEventV1, { type: 'note' }>>, metrics: Array<Extract<SelfScrapeCollectionEventV1, { type: 'metric' }>>) {
  for (const note of notes) { const rows = metrics.filter(({ metric }) => metric.noteId === note.note.platformId); const keys = new Set(rows.map(({ metric }) => metric.key)); if (rows.length !== 3 || keys.size !== 3) throw new Error('collection_metrics_incomplete'); if (new Set(rows.map(({ metric }) => metric.capturedAt)).size !== 1) throw new Error('collection_metric_timestamp_mismatch'); }
}
