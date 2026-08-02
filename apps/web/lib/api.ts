import { cookies } from 'next/headers';

import type { DataAvailabilityState } from '../components/data-availability';

export type DashboardPeriod = 'daily' | 'weekly' | 'monthly';

export type DashboardCard = {
  key: string;
  value: string | null;
  availability: DataAvailabilityState;
};

export type DashboardTrendPoint = { date: string; metrics: DashboardCard[] };
export type DashboardRankedNote = { id: string; accountId: string; title: string; publishedAt: string; metricKey: string; value: string };

export type DashboardResponse = {
  period: DashboardPeriod;
  periodStart: string;
  periodEnd: string;
  source: string | null;
  lastSyncedAt: string | null;
  cards: DashboardCard[];
  trend: DashboardTrendPoint[];
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

export function getDashboard(period: DashboardPeriod) {
  return apiGet<DashboardResponse>(`/dashboard?period=${period}`);
}

export function getRecentNotifications(limit = 5) {
  return apiGet<CursorPage<Notification>>(`/notifications?limit=${limit}`);
}
