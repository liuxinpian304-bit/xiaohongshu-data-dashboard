import type { PlatformCollectionEventV2, Platform, ObservationSource } from '@xhs/domain';

import { normalizeCollectionEvent, type SelfScrapeCollectionEventV1 } from './collection-schema';
import { SelfScrapeValidationError } from './schema';

const platforms = ['xiaohongshu', 'douyin'] as const;
const sources = ['xiaohuohua', 'self-import', 'official', 'mock', 'self-scrape', 'legacy'] as const;
const metricKeys = ['views', 'likes', 'comments', 'favorites', 'shares', 'followers'] as const;

export function normalizePlatformCollectionEvent(input: unknown): PlatformCollectionEventV2 {
  if (isVersionOne(input)) return convertV1(normalizeCollectionEvent(input));

  const root = object(input, 'event', ['version', 'platform', 'source', 'runId', 'type', 'account', 'content', 'metric', 'comment', 'contentId', 'scope', 'status', 'reason', 'completedAt']);
  if (root.version !== 2) fail('invalid_version', 'unsupported collection event version');
  if (!platforms.includes(root.platform as Platform)) fail('invalid_platform', 'platform is unsupported');
  if (!sources.includes(root.source as ObservationSource)) fail('invalid_source', 'source is unsupported');
  const base = {
    version: 2 as const,
    platform: root.platform as Platform,
    source: root.source as ObservationSource,
    runId: text(root.runId, 'runId', 1, 200),
  };

  switch (root.type) {
    case 'account': {
      exact(root, ['version', 'platform', 'source', 'runId', 'type', 'account']);
      const value = object(root.account, 'account', ['platformId', 'displayName', 'avatarUrl']);
      return { ...base, type: 'account', account: {
        platformId: identity(value.platformId, 'account.platformId', base.platform),
        displayName: text(value.displayName, 'account.displayName', 0, 200),
        avatarUrl: nullableText(value.avatarUrl, 'account.avatarUrl', 2_000),
      } };
    }
    case 'content': {
      exact(root, ['version', 'platform', 'source', 'runId', 'type', 'content']);
      const value = object(root.content, 'content', ['platformId', 'contentKind', 'title', 'publishedAt']);
      if (!['note', 'video', 'image_text'].includes(value.contentKind as string)) fail('invalid_content_kind', 'content kind is unsupported');
      return { ...base, type: 'content', content: {
        platformId: identity(value.platformId, 'content.platformId', base.platform),
        contentKind: value.contentKind as 'note' | 'video' | 'image_text',
        title: text(value.title, 'content.title', 0, 1_000),
        publishedAt: timestamp(value.publishedAt, 'content.publishedAt'),
      } };
    }
    case 'metric': {
      exact(root, ['version', 'platform', 'source', 'runId', 'type', 'metric']);
      const value = object(root.metric, 'metric', ['contentId', 'key', 'value', 'availability', 'capturedAt']);
      if (!metricKeys.includes(value.key as typeof metricKeys[number])) fail('invalid_metric', 'metric key is unsupported');
      if (!['available', 'zero', 'not_provided'].includes(value.availability as string)) fail('invalid_availability', 'metric availability is unsupported');
      const availability = value.availability as 'available' | 'zero' | 'not_provided';
      const metricValue = value.value === null ? null : count(value.value, 'metric.value');
      if ((availability === 'not_provided') !== (metricValue === null)) fail('invalid_availability', 'metric value and availability disagree');
      if (availability === 'zero' && metricValue !== 0) fail('invalid_availability', 'zero availability requires zero value');
      return { ...base, type: 'metric', metric: {
        contentId: identity(value.contentId, 'metric.contentId', base.platform),
        key: value.key as typeof metricKeys[number],
        value: metricValue, availability, capturedAt: timestamp(value.capturedAt, 'metric.capturedAt'),
      } } as PlatformCollectionEventV2;
    }
    case 'comment': {
      exact(root, ['version', 'platform', 'source', 'runId', 'type', 'comment']);
      const value = object(root.comment, 'comment', ['platformId', 'contentId', 'parentPlatformId', 'authorName', 'content', 'publishedAt', 'likeCount']);
      return { ...base, type: 'comment', comment: {
        platformId: identity(value.platformId, 'comment.platformId', base.platform),
        contentId: identity(value.contentId, 'comment.contentId', base.platform),
        parentPlatformId: value.parentPlatformId === null ? null : identity(value.parentPlatformId, 'comment.parentPlatformId', base.platform),
        authorName: text(value.authorName, 'comment.authorName', 0, 200),
        content: text(value.content, 'comment.content', 0, 20_000),
        publishedAt: timestamp(value.publishedAt, 'comment.publishedAt'),
        likeCount: count(value.likeCount, 'comment.likeCount'),
      } };
    }
    case 'completeness': {
      exact(root, ['version', 'platform', 'source', 'runId', 'type', 'contentId', 'scope', 'status', 'reason']);
      if (!['comments', 'replies'].includes(root.scope as string)) fail('invalid_completeness', 'invalid completeness scope');
      if (!['complete', 'partial', 'failed', 'not_available'].includes(root.status as string)) fail('invalid_completeness', 'invalid completeness status');
      if (!['platform_end', 'repeated_cursor', 'page_changed', 'authorization_required', 'timeout'].includes(root.reason as string)) fail('invalid_completeness', 'invalid completeness reason');
      if (root.status === 'complete' && root.reason !== 'platform_end') fail('invalid_completeness', 'complete status requires a platform end');
      return { ...base, type: 'completeness', contentId: identity(root.contentId, 'contentId', base.platform), scope: root.scope, status: root.status, reason: root.reason } as PlatformCollectionEventV2;
    }
    case 'completed':
      exact(root, ['version', 'platform', 'source', 'runId', 'type', 'completedAt']);
      return { ...base, type: 'completed', completedAt: timestamp(root.completedAt, 'completedAt') };
    default: fail('invalid_type', 'unsupported collection event type');
  }
}

function convertV1(event: SelfScrapeCollectionEventV1): PlatformCollectionEventV2 {
  const base = { version: 2 as const, platform: 'xiaohongshu' as const, source: 'self-scrape' as const, runId: event.runId };
  switch (event.type) {
    case 'account': return { ...base, type: 'account', account: { ...event.account, avatarUrl: null } };
    case 'note': return { ...base, type: 'content', content: { ...event.note, contentKind: 'note' } };
    case 'metric': return { ...base, type: 'metric', metric: { contentId: event.metric.noteId, key: event.metric.key, value: event.metric.value, availability: event.metric.availability, capturedAt: event.metric.capturedAt } };
    case 'comment': return { ...base, type: 'comment', comment: { platformId: event.comment.platformId, contentId: event.comment.noteId, parentPlatformId: event.comment.parentPlatformId, authorName: '', content: event.comment.content, publishedAt: event.comment.publishedAt, likeCount: event.comment.likeCount } };
    case 'completeness': return { ...base, type: 'completeness', contentId: event.noteId, scope: event.scope, status: event.status === 'page_complete' ? 'complete' : event.status === 'unverifiable' ? 'partial' : event.status === 'authorization_required' ? 'not_available' : 'failed', reason: event.reason };
    case 'completed': return { ...base, type: 'completed', completedAt: event.completedAt };
  }
}

function isVersionOne(input: unknown): boolean { return Boolean(input && typeof input === 'object' && !Array.isArray(input) && (input as Record<string, unknown>).version === 1); }
function object(input: unknown, path: string, allowed: string[]) { if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('invalid_object', `${path} must be a plain object`); const value = input as Record<string, unknown>; if (Object.keys(value).some((key) => !allowed.includes(key))) fail('unknown_field', `${path} contains unsupported fields`); return value; }
function exact(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some((key) => !allowed.includes(key))) fail('unknown_field', 'event contains unsupported fields'); }
function text(input: unknown, path: string, min: number, max: number) { if (typeof input !== 'string' || Array.from(input).length < min || Array.from(input).length > max) fail('invalid_string', `${path} has an invalid length`); return input as string; }
function nullableText(input: unknown, path: string, max: number) { return input === null ? null : text(input, path, 1, max); }
function identity(input: unknown, path: string, platform: Platform) { const value = text(input, path, 1, 200); const match = /^(xiaohongshu|douyin):/.exec(value); if (match && match[1] !== platform) fail('cross_platform_id', `${path} belongs to another platform`); return value; }
function count(input: unknown, path: string) { if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) fail('invalid_count', `${path} must be a non-negative safe integer`); return input; }
function timestamp(input: unknown, path: string) { if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(input)) fail('invalid_timestamp', `${path} must include a timezone`); const value = new Date(input); if (!Number.isFinite(value.getTime())) fail('invalid_timestamp', `${path} is not a real timestamp`); return value.toISOString(); }
function fail(code: string, message: string): never { throw new SelfScrapeValidationError(code, message); }
