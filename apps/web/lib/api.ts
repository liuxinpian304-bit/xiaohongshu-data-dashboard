import { cookies } from 'next/headers';

import type { DataAvailabilityState } from '../components/data-availability';

export type DashboardPeriod = 'daily' | 'weekly' | 'monthly';
export type DashboardSource = 'official' | 'self-scrape';

export type DashboardCard = {
  key: string;
  aggregation: 'cumulative_delta' | 'sum_interval' | 'period_end' | 'deduplicated_period';
  value: string | null;
  availability: DataAvailabilityState;
};

export type DashboardTrendPoint = { date: string; metrics: DashboardCard[] };
export type DashboardMetricDelta = { key: string; value: string | null; availability: DataAvailabilityState };
export type DashboardDailyRow = { date: string; metrics: DashboardCard[]; deltas: DashboardMetricDelta[] };
export type DashboardRankedNote = { id: string; accountId: string; title: string; publishedAt: string; metricKey: string; metricLabel: string; value: string };
export type Account = { id: string; platform: 'xiaohongshu' | 'douyin'; source: string; connectorType: string; platformId: string; xhsAccountId: string | null; displayName: string | null; avatarUrl: string | null; identityVerifiedAt: string | null; capabilities: Array<{ enabled: boolean }> };
export type SyncJob = { id: string; accountId: string; status: 'pending' | 'running' | 'succeeded' | 'failed'; currentStage: string; error: string | null; createdAt: string; startedAt: string | null; completedAt: string | null };
export type NoteMetric = { key: string; displayName: string; availability: DataAvailabilityState; value: string | null; source: string; observedAt: string };
export type CommentSyncCompleteness = { status: string; error: string | null; updatedAt: string } | null;
export type Note = { id: string; accountId: string; platform: 'xiaohongshu' | 'douyin'; connectorType: string; platformId: string; title: string; publishedAt: string; lastSeenAt: string; account: { id: string; platform: 'xiaohongshu' | 'douyin'; displayName: string | null; platformId: string }; metrics: NoteMetric[]; commentCompleteness: CommentSyncCompleteness };
export type NoteDetail = Note;
export type Comment = { id: string; noteId: string | null; connectorType: string; platformId: string; parentPlatformId: string | null; authorName?: string | null; content: string; publishedAt: string; likeCount: number; source: string };
export type SettingsHealth = 'healthy' | 'unhealthy' | 'disabled';
export type SettingsStatus = { api: SettingsHealth; database: SettingsHealth; collector: SettingsHealth; account: { displayName: string; xhsAccountId: string | null; platformId: string; avatarUrl: string | null; loginState: 'authenticated' } | null; version: string; timezone: 'Asia/Shanghai' };

export type DashboardResponse = {
  period: DashboardPeriod;
  periodStart: string;
  periodEnd: string;
  source: string | null;
  lastSyncedAt: string | null;
  cards: DashboardCard[];
  trend: DashboardTrendPoint[];
  dailyRows: DashboardDailyRow[];
  rankedNotes: DashboardRankedNote[];
};

export type Notification = {
  id: string;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
};

export type CursorPage<T> = {
  items: T[];
  pageInfo: { nextCursor: string | null; hasMore: boolean };
};

export type ApiResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'unauthorized' }
  | { status: 'error'; kind: 'network' | 'server' | 'parse'; message: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const apiBaseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';

export async function requestJson<T>(input: string, init?: RequestInit, fetcher: FetchLike = fetch): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetcher(input, init);
  } catch {
    return { status: 'error', kind: 'network', message: '无法连接数据服务' };
  }
  if (response.status === 401 || response.status === 403) return { status: 'unauthorized' };
  if (!response.ok) return { status: 'error', kind: 'server', message: '服务暂时不可用' };
  try {
    return { status: 'ok', data: await response.json() as T };
  } catch {
    return { status: 'error', kind: 'parse', message: '服务返回了无法识别的数据' };
  }
}

async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  return requestJson<T>(`${apiBaseUrl}${path}`, {
    cache: 'no-store',
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
}

export function getAccounts(cursor?: string) { const q = new URLSearchParams({ limit: '50' }); if (cursor) q.set('cursor', cursor); return apiGet<CursorPage<Account>>(`/accounts?${q}`); }
export function getJobs(cursor?: string) { const q = new URLSearchParams({ limit: '50' }); if (cursor) q.set('cursor', cursor); return apiGet<CursorPage<SyncJob>>(`/jobs?${q}`); }
export function getNotes(accountId?: string, cursor?: string, platform?: 'xiaohongshu' | 'douyin') { const q = new URLSearchParams({ limit: '50' }); if (accountId) q.set('accountId', accountId); if (cursor) q.set('cursor', cursor); if (platform) q.set('platform', platform); return apiGet<CursorPage<Note>>(`/notes?${q}`); }
export function getNote(id: string) { return apiGet<NoteDetail>(`/notes/${encodeURIComponent(id)}`); }
export function getComments(query: Record<string, string | undefined>) { const q = new URLSearchParams({ limit: '50' }); for (const [key, value] of Object.entries(query)) if (value) q.set(key, value); return apiGet<CursorPage<Comment>>(`/comments?${q}`); }

export function dashboardPath(period: DashboardPeriod, accountId: string | undefined, source: DashboardSource) {
  const query = new URLSearchParams({ period, source });
  if (accountId) query.set('accountId', accountId);
  return `/dashboard?${query}`;
}

export function getDashboard(period: DashboardPeriod, accountId?: string, source: DashboardSource = 'self-scrape') {
  return apiGet<DashboardResponse>(dashboardPath(period, accountId, source));
}

export async function getAuthorizedOfficialAccounts() {
  return collectCursorPages<Account>((cursor) => {
    const query = new URLSearchParams({ limit: '200' }); if (cursor) query.set('cursor', cursor);
    return apiGet<CursorPage<Account>>(`/accounts/authorized-official?${query}`);
  });
}

export async function getSelfScrapeAccounts() {
  const result = await collectCursorPages<Account>((cursor) => getAccounts(cursor ?? undefined));
  if (result.status !== 'ok') return result;
  return { ...result, data: { ...result.data, items: result.data.items.filter(({ connectorType }) => connectorType === 'self-scrape') } };
}

export async function collectCursorPages<T>(load: (cursor: string | null) => Promise<ApiResult<CursorPage<T>>>) {
  const items: T[] = []; let cursor: string | null = null; const seen = new Set<string>(); let pages = 0;
  do {
    if (pages++ >= 1_000 || items.length >= 100_000) return { status: 'error', kind: 'server', message: '账号数量超出单次安全读取范围，请使用账号搜索缩小范围' } as const;
    const result = await load(cursor);
    if (result.status !== 'ok') return result;
    if (items.length + result.data.items.length > 100_000) return { status: 'error', kind: 'server', message: '账号数量超出单次安全读取范围，请使用账号搜索缩小范围' } as const;
    items.push(...result.data.items);
    const next = result.data.pageInfo.hasMore ? result.data.pageInfo.nextCursor : null;
    if (result.data.pageInfo.hasMore && (!next || seen.has(next))) return { status: 'error', kind: 'server', message: '账号分页游标无效，请刷新后重试' } as const;
    if (next) seen.add(next); cursor = next;
  } while (cursor);
  return { status: 'ok', data: { items, pageInfo: { nextCursor: null, hasMore: false } } } as const;
}

export function getRecentNotifications(limit = 5) {
  return apiGet<CursorPage<Notification>>(`/notifications?limit=${limit}`);
}

export function getSettingsStatus() { return apiGet<SettingsStatus>('/settings/status'); }
