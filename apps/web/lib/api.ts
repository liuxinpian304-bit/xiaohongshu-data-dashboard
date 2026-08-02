import { cookies } from 'next/headers';

import type { DataAvailabilityState } from '../components/data-availability';

export type DashboardPeriod = 'daily' | 'weekly' | 'monthly';

export type DashboardCard = {
  key: string;
  value: string | null;
  availability: DataAvailabilityState;
};

export type DashboardResponse = {
  period: DashboardPeriod;
  cards: DashboardCard[];
};

export type Notification = {
  id: string;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
};

type CursorPage<T> = {
  items: T[];
  pageInfo: { nextCursor: string | null; hasMore: boolean };
};

const apiBaseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';

async function apiGet<T>(path: string): Promise<T | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      cache: 'no-store',
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function getDashboard(period: DashboardPeriod) {
  return apiGet<DashboardResponse>(`/dashboard?period=${period}`);
}

export function getRecentNotifications(limit = 5) {
  return apiGet<CursorPage<Notification>>(`/notifications?limit=${limit}`);
}
