export const SELF_SCRAPE_SOURCE = 'self-scrape' as const;
export const SELF_SCRAPE_AGGREGATION_VERSION = 'jsonl-v1' as const;

export type MetricAvailability = 'available' | 'zero' | 'not_provided';

export interface NormalizedSelfScrapeRecord {
  note: {
    connectorType: typeof SELF_SCRAPE_SOURCE;
    platformId: string;
    inputAccountId: string;
    title: string;
    publishedAt: string;
  };
  metrics: Array<{
    key: 'views' | 'likes' | 'comments';
    availability: MetricAvailability;
    value: number | null;
    capturedAt: string;
    source: typeof SELF_SCRAPE_SOURCE;
    aggregation: 'cumulative_delta';
    aggregationVersion: typeof SELF_SCRAPE_AGGREGATION_VERSION;
    authoritativePeriod: false;
    windowStart: null;
    windowEnd: null;
  }>;
  extra?: { collected?: number; shares?: number };
}

export class SelfScrapeValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SelfScrapeValidationError';
  }
}

export function normalizeSelfScrapeRecord(input: unknown): NormalizedSelfScrapeRecord {
  const root = strictObject(input, 'record', ['note', 'metrics', 'extra', 'views_available']);
  requireKeys(root, 'record', ['note', 'metrics', 'views_available']);
  const note = strictObject(root.note, 'note', ['platformId', 'accountId', 'title', 'publishedAt', 'source']);
  const metrics = strictObject(root.metrics, 'metrics', ['noteId', 'capturedAt', 'views', 'likes', 'comments', 'source']);
  requireKeys(note, 'note', ['platformId', 'accountId', 'title', 'publishedAt', 'source']);
  requireKeys(metrics, 'metrics', ['noteId', 'capturedAt', 'views', 'likes', 'comments', 'source']);

  const platformId = boundedString(note.platformId, 'note.platformId', 1, 200);
  const noteId = boundedString(metrics.noteId, 'metrics.noteId', 1, 200);
  if (noteId !== platformId) fail('note_id_mismatch', 'metrics.noteId must equal note.platformId');
  if (note.source !== SELF_SCRAPE_SOURCE || metrics.source !== SELF_SCRAPE_SOURCE) fail('invalid_source', 'source must be self-scrape');

  const capturedAt = isoTimestamp(metrics.capturedAt, 'metrics.capturedAt');
  const values = {
    views: safeCount(metrics.views, 'metrics.views'),
    likes: safeCount(metrics.likes, 'metrics.likes'),
    comments: safeCount(metrics.comments, 'metrics.comments'),
  };
  if (typeof root.views_available !== 'boolean') fail('invalid_boolean', 'views_available must be boolean');

  const extra = root.extra === undefined ? undefined : normalizeExtra(root.extra);
  const availability = (value: number): MetricAvailability => value === 0 ? 'zero' : 'available';
  const metric = (key: 'views' | 'likes' | 'comments', value: number, available = true) => ({
    key,
    availability: available ? availability(value) : 'not_provided' as MetricAvailability,
    value: available ? value : null,
    capturedAt,
    source: SELF_SCRAPE_SOURCE,
    aggregation: 'cumulative_delta' as const,
    aggregationVersion: SELF_SCRAPE_AGGREGATION_VERSION,
    authoritativePeriod: false as const,
    windowStart: null,
    windowEnd: null,
  });

  return {
    note: {
      connectorType: SELF_SCRAPE_SOURCE,
      platformId,
      inputAccountId: boundedString(note.accountId, 'note.accountId', 0, 200),
      title: boundedString(note.title, 'note.title', 0, 1_000),
      publishedAt: isoTimestamp(note.publishedAt, 'note.publishedAt'),
    },
    metrics: [
      metric('views', values.views, root.views_available),
      metric('likes', values.likes),
      metric('comments', values.comments),
    ],
    ...(extra ? { extra } : {}),
  };
}

function normalizeExtra(input: unknown) {
  const extra = strictObject(input, 'extra', ['collected', 'shares']);
  return {
    ...(extra.collected === undefined ? {} : { collected: safeCount(extra.collected, 'extra.collected') }),
    ...(extra.shares === undefined ? {} : { shares: safeCount(extra.shares, 'extra.shares') }),
  };
}

function strictObject(input: unknown, path: string, allowed: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_object', `${path} must be an object`);
  const value = input as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('invalid_object', `${path} must be a plain object`);
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) fail('unknown_field', `${path} contains unsupported fields`);
  return value;
}

function requireKeys(value: Record<string, unknown>, path: string, keys: string[]) {
  const missing = keys.find((key) => !Object.hasOwn(value, key));
  if (missing) fail('missing_field', `${path}.${missing} is required`);
}

function boundedString(input: unknown, path: string, min: number, max: number) {
  if (typeof input !== 'string') fail('invalid_string', `${path} has an invalid length`);
  const length = Array.from(input).length;
  if (length < min || length > max) fail('invalid_string', `${path} has an invalid length`);
  return input;
}

function safeCount(input: unknown, path: string) {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) fail('invalid_count', `${path} must be a non-negative safe integer`);
  return input;
}

function isoTimestamp(input: unknown, path: string) {
  if (typeof input !== 'string') fail('invalid_timestamp', `${path} must be an ISO-8601 timestamp`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(input);
  if (!match) fail('invalid_timestamp', `${path} must include a timezone`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const hour = Number(hourText); const minute = Number(minuteText); const second = Number(secondText);
  const zoneValid = zone === 'Z' || (() => { const [h, m] = zone.slice(1).split(':').map(Number); return h <= 23 && m <= 59; })();
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59 || !zoneValid) fail('invalid_timestamp', `${path} is not a real timestamp`);
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) fail('invalid_timestamp', `${path} is not a real timestamp`);
  return date.toISOString();
}

function fail(code: string, message: string): never {
  throw new SelfScrapeValidationError(code, message);
}
