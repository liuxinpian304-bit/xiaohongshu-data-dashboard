import type { CollectionProgress } from './collection-run';
import type { CreatorCommentRecord, CreatorNoteRecord } from './creator-payload';

export type CreatorCollectionEvent =
  | { version: 1; type: 'note'; source: 'self-scrape'; runId: string; note: { platformId: string; title: string; publishedAt: string } }
  | { version: 1; type: 'metric'; source: 'self-scrape'; runId: string; metric: { noteId: string; key: 'views' | 'likes' | 'comments'; value: number | null; availability: 'available' | 'zero' | 'not_provided'; capturedAt: string } }
  | { version: 1; type: 'comment'; source: 'self-scrape'; runId: string; comment: CreatorCommentRecord }
  | { version: 1; type: 'completeness'; source: 'self-scrape'; runId: string; noteId: string; scope: 'comments'; status: 'unverifiable' | 'page_complete'; reason: 'page_changed' | 'platform_end' }
  | { version: 1; type: 'completed'; source: 'self-scrape'; runId: string; completedAt: string };

interface VisibleRecordCollector { collectVisibleRecords(capturedAt?: string): Promise<{ notes: CreatorNoteRecord[]; comments: CreatorCommentRecord[] }> }

export async function collectCreatorEvents(
  adapter: VisibleRecordCollector,
  progress: (value: CollectionProgress) => void,
  emit: (event: CreatorCollectionEvent) => void,
  runId: string,
  capturedAt = new Date().toISOString(),
) {
  progress({ stage: 'notes', processed: 0, total: 0, incompleteNotes: 0 });
  const records = await adapter.collectVisibleRecords(capturedAt);
  const noteIds = new Set(records.notes.map(({ platformId }) => platformId));
  const total = records.notes.length;
  const incompleteNotes = records.notes.filter((note) => note.metrics.comments !== 0).length;
  records.notes.forEach((note, index) => {
    emit({ version: 1, type: 'note', source: 'self-scrape', runId, note: { platformId: note.platformId, title: note.title, publishedAt: note.publishedAt } });
    progress({ stage: 'notes', processed: index + 1, total, incompleteNotes: 0 });
  });
  for (const note of records.notes) {
    for (const key of ['views', 'likes', 'comments'] as const) {
      const value = note.metrics[key];
      emit({ version: 1, type: 'metric', source: 'self-scrape', runId, metric: { noteId: note.platformId, key, value, availability: value === null ? 'not_provided' : value === 0 ? 'zero' : 'available', capturedAt: note.capturedAt } });
    }
  }
  progress({ stage: 'metrics', processed: total, total, incompleteNotes: 0 });
  const comments = records.comments.filter(({ noteId }) => noteIds.has(noteId));
  comments.forEach((comment, index) => {
    emit({ version: 1, type: 'comment', source: 'self-scrape', runId, comment });
    progress({ stage: comment.parentPlatformId ? 'replies' : 'comments', processed: index + 1, total: comments.length, incompleteNotes });
  });
  for (const note of records.notes) emit({ version: 1, type: 'completeness', source: 'self-scrape', runId, noteId: note.platformId, scope: 'comments', status: note.metrics.comments === 0 ? 'page_complete' : 'unverifiable', reason: note.metrics.comments === 0 ? 'platform_end' : 'page_changed' });
  progress({ stage: 'writing', processed: total, total, incompleteNotes });
  progress({ stage: 'reports', processed: total, total, incompleteNotes });
  emit({ version: 1, type: 'completed', source: 'self-scrape', runId, completedAt: capturedAt });
}
