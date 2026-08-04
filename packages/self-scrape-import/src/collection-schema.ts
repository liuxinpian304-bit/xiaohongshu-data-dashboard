import { SELF_SCRAPE_SOURCE, SelfScrapeValidationError } from './schema';

const VERSION = 1 as const;
type Base = { version: typeof VERSION; source: typeof SELF_SCRAPE_SOURCE; runId: string };
export type SelfScrapeCollectionEventV1 = Base & (
  | { type: 'account'; account: { platformId: string; displayName: string } }
  | { type: 'note'; note: { platformId: string; title: string; publishedAt: string } }
  | { type: 'metric'; metric: { noteId: string; key: 'views' | 'likes' | 'comments'; value: number | null; availability: 'available' | 'zero' | 'not_provided'; capturedAt: string } }
  | { type: 'comment'; comment: { platformId: string; noteId: string; parentPlatformId: string | null; content: string; publishedAt: string; likeCount: number } }
  | { type: 'completeness'; noteId: string; scope: 'comments' | 'replies'; status: 'page_complete' | 'unverifiable' | 'authorization_required' | 'failed'; reason: 'platform_end' | 'repeated_cursor' | 'page_changed' | 'authorization_required' | 'timeout' }
  | { type: 'completed'; completedAt: string }
);

export function normalizeCollectionEvent(input: unknown): SelfScrapeCollectionEventV1 {
  const root = object(input, 'event', ['version', 'type', 'source', 'runId', 'account', 'note', 'metric', 'comment', 'noteId', 'scope', 'status', 'reason', 'completedAt']);
  if (root.version !== VERSION) fail('invalid_version', 'unsupported collection event version');
  if (root.source !== SELF_SCRAPE_SOURCE) fail('invalid_source', 'source must be self-scrape');
  const base = { version: VERSION, source: SELF_SCRAPE_SOURCE, runId: string(root.runId, 'runId', 1, 200) };
  switch (root.type) {
    case 'account': {
      exactRoot(root, ['version', 'type', 'source', 'runId', 'account']);
      const value = object(root.account, 'account', ['platformId', 'displayName']);
      return { ...base, type: 'account', account: { platformId: string(value.platformId, 'account.platformId', 1, 200), displayName: string(value.displayName, 'account.displayName', 0, 200) } };
    }
    case 'note': {
      exactRoot(root, ['version', 'type', 'source', 'runId', 'note']);
      const value = object(root.note, 'note', ['platformId', 'title', 'publishedAt']);
      return { ...base, type: 'note', note: { platformId: string(value.platformId, 'note.platformId', 1, 200), title: string(value.title, 'note.title', 0, 1_000), publishedAt: timestamp(value.publishedAt, 'note.publishedAt') } };
    }
    case 'metric': {
      exactRoot(root, ['version', 'type', 'source', 'runId', 'metric']);
      const value = object(root.metric, 'metric', ['noteId', 'key', 'value', 'availability', 'capturedAt']);
      if (!['views', 'likes', 'comments'].includes(value.key as string)) fail('invalid_metric', 'metric key is unsupported');
      if (!['available', 'zero', 'not_provided'].includes(value.availability as string)) fail('invalid_availability', 'metric availability is unsupported');
      const availability = value.availability as 'available' | 'zero' | 'not_provided';
      const metricValue = value.value === null ? null : count(value.value, 'metric.value');
      if ((availability === 'not_provided') !== (metricValue === null)) fail('invalid_availability', 'metric value and availability disagree');
      return { ...base, type: 'metric', metric: { noteId: string(value.noteId, 'metric.noteId', 1, 200), key: value.key as 'views' | 'likes' | 'comments', value: metricValue, availability, capturedAt: timestamp(value.capturedAt, 'metric.capturedAt') } };
    }
    case 'comment': {
      exactRoot(root, ['version', 'type', 'source', 'runId', 'comment']);
      const value = object(root.comment, 'comment', ['platformId', 'noteId', 'parentPlatformId', 'content', 'publishedAt', 'likeCount']);
      return { ...base, type: 'comment', comment: { platformId: string(value.platformId, 'comment.platformId', 1, 200), noteId: string(value.noteId, 'comment.noteId', 1, 200), parentPlatformId: value.parentPlatformId === null ? null : string(value.parentPlatformId, 'comment.parentPlatformId', 1, 200), content: string(value.content, 'comment.content', 0, 20_000), publishedAt: timestamp(value.publishedAt, 'comment.publishedAt'), likeCount: count(value.likeCount, 'comment.likeCount') } };
    }
    case 'completeness': {
      exactRoot(root, ['version', 'type', 'source', 'runId', 'noteId', 'scope', 'status', 'reason']);
      if (!['comments', 'replies'].includes(root.scope as string)) fail('invalid_completeness', 'invalid completeness scope');
      if (!['page_complete', 'unverifiable', 'authorization_required', 'failed'].includes(root.status as string)) fail('invalid_completeness', 'invalid completeness status');
      if (!['platform_end', 'repeated_cursor', 'page_changed', 'authorization_required', 'timeout'].includes(root.reason as string)) fail('invalid_completeness', 'invalid completeness reason');
      if (root.status === 'page_complete' && root.reason !== 'platform_end') fail('invalid_completeness', 'complete status requires a platform end');
      return { ...base, type: 'completeness', noteId: string(root.noteId, 'noteId', 1, 200), scope: root.scope as 'comments' | 'replies', status: root.status as 'page_complete' | 'unverifiable' | 'authorization_required' | 'failed', reason: root.reason as 'platform_end' | 'repeated_cursor' | 'page_changed' | 'authorization_required' | 'timeout' };
    }
    case 'completed':
      exactRoot(root, ['version', 'type', 'source', 'runId', 'completedAt']);
      return { ...base, type: 'completed', completedAt: timestamp(root.completedAt, 'completedAt') };
    default: fail('invalid_type', 'unsupported collection event type');
  }
}

function object(input: unknown, path: string, allowed: string[]) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_object', `${path} must be a plain object`);
  const value = input as Record<string, unknown>;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_object', `${path} must be a plain object`);
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail('unknown_field', `${path} contains unsupported fields`);
  return value;
}
function exactRoot(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some((key) => !allowed.includes(key))) fail('unknown_field', 'event contains unsupported fields'); }
function string(input: unknown, path: string, min: number, max: number) { if (typeof input !== 'string' || Array.from(input).length < min || Array.from(input).length > max) fail('invalid_string', `${path} has an invalid length`); return input as string; }
function count(input: unknown, path: string) { if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) fail('invalid_count', `${path} must be a non-negative safe integer`); return input; }
function timestamp(input: unknown, path: string) { if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(input)) fail('invalid_timestamp', `${path} must include a timezone`); const value = new Date(input); if (!Number.isFinite(value.getTime())) fail('invalid_timestamp', `${path} is not a real timestamp`); return value.toISOString(); }
function fail(code: string, message: string): never { throw new SelfScrapeValidationError(code, message); }
