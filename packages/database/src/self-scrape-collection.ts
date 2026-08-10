import { normalizeCollectionEvent, normalizePlatformCollectionEvent, type SelfScrapeCollectionEventV1 } from '@xhs/self-scrape-import';

import type { DatabaseClient } from './client';
import { importPlatformCollection } from './platform-collection';

export interface SelfScrapeCollectionOptions { db: DatabaseClient; runId: string; accountPlatformId: string }
export interface SelfScrapeCollectionSummary { accountId: string; notesChanged: number; snapshotsChanged: number; commentsChanged: number; incompleteNotes: number; sha256: string }

export async function importSelfScrapeCollection(input: Iterable<unknown>, options: SelfScrapeCollectionOptions): Promise<SelfScrapeCollectionSummary> {
  const legacy = [...input].map(normalizeCollectionEvent);
  validateLegacyMetrics(legacy);
  const events = legacy.map(normalizePlatformCollectionEvent);

  // V1 only had one terminal comment marker. Treat it as proof for both scopes
  // so existing imports retain their original completeness semantics.
  for (const event of [...events]) if (event.type === 'completeness' && event.scope === 'comments' && event.status === 'complete') {
    events.push({ ...event, scope: 'replies' });
  }

  const summary = await importPlatformCollection(events, {
    db: options.db,
    runId: options.runId,
    platform: 'xiaohongshu',
    accountPlatformId: options.accountPlatformId,
    source: 'self-scrape',
  });
  return {
    accountId: summary.accountId,
    notesChanged: summary.contentsChanged,
    snapshotsChanged: summary.snapshotsChanged,
    commentsChanged: summary.commentsChanged,
    incompleteNotes: summary.incompleteContents,
    sha256: summary.sha256,
  };
}

function validateLegacyMetrics(events: SelfScrapeCollectionEventV1[]) {
  const notes = events.filter((event): event is Extract<SelfScrapeCollectionEventV1, { type: 'note' }> => event.type === 'note');
  const metrics = events.filter((event): event is Extract<SelfScrapeCollectionEventV1, { type: 'metric' }> => event.type === 'metric');
  for (const note of notes) {
    const rows = metrics.filter(({ metric }) => metric.noteId === note.note.platformId);
    const keys = new Set(rows.map(({ metric }) => metric.key));
    if (rows.length !== 3 || keys.size !== 3) throw new Error('collection_metrics_incomplete');
    if (new Set(rows.map(({ metric }) => metric.capturedAt)).size !== 1) throw new Error('collection_metric_timestamp_mismatch');
  }
}
