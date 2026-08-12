import type { PlatformCollectionEventV2, PlatformMetricKey } from '@xhs/domain';

import type { DouyinIdentity } from './douyin-types';

type JsonObject = Record<string, unknown>;
const base = (runId: string) => ({ version: 2 as const, platform: 'douyin' as const, source: 'self-scrape' as const, runId });

export type DouyinCollectionMode = 'daily' | 'previous_month_final';
export function collectDouyinEvents(identity: DouyinIdentity, payloads: unknown[], runId: string, capturedAt: string, options: { mode?: DouyinCollectionMode } = {}): PlatformCollectionEventV2[] {
  const events: PlatformCollectionEventV2[] = [{ ...base(runId), type: 'account', account: { platformId: identity.platformId, displayName: identity.displayName, avatarUrl: identity.avatarUrl } }];
  const window = collectionWindow(new Date(capturedAt), options.mode ?? 'daily');
  const works = uniqueById(payloads.flatMap(findWorks)).filter((work) => publishedInWindow(work, window));
  const comments = payloads.flatMap(findComments);

  for (const work of works) {
    const id = idOf(work, ['aweme_id', 'item_id', 'video_id', 'id']);
    if (!id) continue;
    events.push({ ...base(runId), type: 'content', content: { platformId: id, contentKind: 'video', title: textOf(work, ['desc', 'title', 'caption']) || `抖音作品 ${id}`, publishedAt: dateOf(work, ['create_time', 'publish_time', 'published_at']) ?? capturedAt } });
    for (const [key, aliases] of Object.entries(metricAliases) as [PlatformMetricKey, string[]][]) {
      const value = numberOf(work, aliases) ?? numberOf(objectOf(work.statistics), aliases);
      events.push({ ...base(runId), type: 'metric', metric: { contentId: id, key, value: value ?? null, availability: value === undefined ? 'not_provided' : value === 0 ? 'zero' : 'available', capturedAt } });
    }
  }

  const commentContentIds = new Set<string>();
  for (const comment of comments) {
    const platformId = idOf(comment, ['cid', 'comment_id', 'id']);
    const contentId = idOf(comment, ['aweme_id', 'item_id', 'video_id', 'content_id']);
    if (!platformId || !contentId) continue;
    commentContentIds.add(contentId);
    events.push({ ...base(runId), type: 'comment', comment: { platformId, contentId, parentPlatformId: idOf(comment, ['reply_id', 'reply_to_comment_id', 'parent_id']), authorName: textOf(objectOf(comment.user), ['nickname', 'name']) || textOf(comment, ['user_name', 'author_name']) || '抖音用户', content: textOf(comment, ['text', 'content']) || '', publishedAt: dateOf(comment, ['create_time', 'publish_time', 'published_at']) ?? capturedAt, likeCount: numberOf(comment, ['digg_count', 'like_count']) ?? 0 } });
  }
  const completedCommentIds = explicitCommentEnds(payloads);
  for (const contentId of commentContentIds) events.push({ ...base(runId), type: 'completeness', contentId, scope: 'comments', status: completedCommentIds.has(contentId) ? 'complete' : 'partial', reason: completedCommentIds.has(contentId) ? 'platform_end' : 'page_changed' });
  events.push({ ...base(runId), type: 'completed', completedAt: capturedAt });
  return events;
}

export function collectionWindow(now: Date, mode: DouyinCollectionMode) {
  const parts = shanghaiParts(now); const day = Number(parts.day); const year = Number(parts.year); const month = Number(parts.month);
  if (mode === 'previous_month_final') {
    if (day !== 1) throw new Error('douyin_previous_month_not_allowed');
    const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
    const lastDay = new Date(Date.UTC(previous.year, previous.month, 0)).getUTCDate();
    return { from: localBoundary(previous.year, previous.month, 1, false), to: localBoundary(previous.year, previous.month, lastDay, true) };
  }
  return { from: localBoundary(year, month, 1, false), to: localBoundary(year, month, day, true) };
}

export class DouyinCursorTracker {
  private readonly cursors = new Set<string>();
  private pages = 0;
  constructor(private readonly maxPages = 1_000) {}
  accept(cursor: string) {
    if (this.cursors.has(cursor)) throw new Error('douyin_repeated_cursor');
    if (this.pages >= this.maxPages) throw new Error('douyin_page_limit');
    this.cursors.add(cursor); this.pages += 1; return true;
  }
}

const metricAliases: Record<'views' | 'likes' | 'comments' | 'favorites' | 'shares', string[]> = {
  views: ['play_count', 'view_count', 'views'], likes: ['digg_count', 'like_count', 'likes'], comments: ['comment_count', 'comments'], favorites: ['collect_count', 'favorite_count', 'favorites'], shares: ['share_count', 'shares'],
};

function findWorks(value: unknown): JsonObject[] { return findArrays(value, new Set(['aweme_list', 'item_list', 'video_list', 'works', 'contents'])); }
function findComments(value: unknown): JsonObject[] { return findArrays(value, new Set(['comments', 'comment_list'])); }
function explicitCommentEnds(payloads: unknown[]) {
  const result = new Set<string>();
  for (const payload of payloads) visit(payload, (value) => {
    const comments = Array.isArray(value.comments) ? value.comments.filter(isObject) : Array.isArray(value.comment_list) ? value.comment_list.filter(isObject) : null;
    if (!comments || value.has_more !== false) return;
    for (const comment of comments) { const contentId = idOf(comment, ['aweme_id', 'item_id', 'video_id', 'content_id']); if (contentId) result.add(contentId); }
  });
  return result;
}
function visit(value: unknown, callback: (value: JsonObject) => void, depth = 0) { if (depth > 8 || !value || typeof value !== 'object') return; if (Array.isArray(value)) { for (const item of value.slice(0, 1_000)) visit(item, callback, depth + 1); return; } callback(value as JsonObject); for (const child of Object.values(value as JsonObject).slice(0, 1_000)) visit(child, callback, depth + 1); }
function findArrays(value: unknown, keys: Set<string>, depth = 0): JsonObject[] {
  if (depth > 8 || !value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item) => findArrays(item, keys, depth + 1));
  const found: JsonObject[] = [];
  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (keys.has(key) && Array.isArray(child)) found.push(...child.filter(isObject));
    else found.push(...findArrays(child, keys, depth + 1));
  }
  return found;
}
function uniqueById(items: JsonObject[]) { const seen = new Set<string>(); return items.filter((item) => { const id = idOf(item, ['aweme_id', 'item_id', 'video_id', 'id']); if (!id || seen.has(id)) return false; seen.add(id); return true; }); }
function isObject(value: unknown): value is JsonObject { return !!value && typeof value === 'object' && !Array.isArray(value); }
function objectOf(value: unknown) { return isObject(value) ? value : {}; }
function idOf(value: JsonObject, aliases: string[]) { for (const key of aliases) { const item = value[key]; if (typeof item === 'string' && item.trim()) return item.trim().slice(0, 200); if (typeof item === 'number' && Number.isSafeInteger(item)) return String(item); } return null; }
function textOf(value: JsonObject, aliases: string[]) { for (const key of aliases) { const item = value[key]; if (typeof item === 'string' && item.trim()) return item.trim().slice(0, 500); } return ''; }
function numberOf(value: JsonObject, aliases: string[]) { for (const key of aliases) { const item = value[key]; if (typeof item === 'number' && Number.isSafeInteger(item) && item >= 0) return item; if (typeof item === 'string' && /^\d+$/.test(item)) { const parsed = Number(item); if (Number.isSafeInteger(parsed)) return parsed; } } return undefined; }
function dateOf(value: JsonObject, aliases: string[]) { for (const key of aliases) { const item = value[key]; if (typeof item === 'number' && item > 0) return new Date(item < 10_000_000_000 ? item * 1000 : item).toISOString(); if (typeof item === 'string' && Number.isFinite(Date.parse(item))) return new Date(item).toISOString(); } return null; }
function publishedInWindow(work: JsonObject, window: { from: string; to: string }) {
  const status = textOf(work, ['status', 'publish_status', 'state']).toLowerCase();
  if (['scheduled', 'draft', 'unpublished', 'reviewing'].includes(status) || work.is_published === false) return false;
  const publishedAt = dateOf(work, ['create_time', 'publish_time', 'published_at']);
  return !!publishedAt && Date.parse(publishedAt) >= Date.parse(window.from) && Date.parse(publishedAt) <= Date.parse(window.to);
}
function shanghaiParts(date: Date) { return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])) as { year: string; month: string; day: string }; }
function localBoundary(year: number, month: number, day: number, end: boolean) { return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${end ? '23:59:59.999' : '00:00:00'}+08:00`; }
