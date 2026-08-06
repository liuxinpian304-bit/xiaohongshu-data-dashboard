import type { DataAvailabilityState } from './data-availability';
import type { DashboardCard, DashboardDailyRow, DashboardMetricDelta } from '../lib/api';
import { formatMetric } from '../lib/format';

export const dailyMetricLabels: Record<string, string> = {
  notes: '笔记', views: '访客', likes: '点赞', comments: '评论', favorites: '收藏',
};

export const dailyMetricKeys = ['notes', 'views', 'likes', 'comments', 'favorites'] as const;
export const trendMetricKeys = ['views', 'likes', 'comments', 'favorites'] as const;

export function shortDate(date: string) {
  const [, month = '', day = ''] = date.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

export function usable(value: { value: string | null; availability: DataAvailabilityState } | undefined) {
  return Boolean(value && value.value !== null && (value.availability === 'available' || value.availability === 'zero'));
}

export function metricFor(row: DashboardDailyRow, key: string): DashboardCard | undefined {
  return row.metrics.find((metric) => metric.key === key);
}

export function deltaFor(row: DashboardDailyRow, key: string): DashboardMetricDelta | undefined {
  return row.deltas.find((delta) => delta.key === key);
}

export function unavailableLabel(availability: DataAvailabilityState | undefined) {
  if (availability === 'not_provided') return '暂无数据';
  if (availability === 'awaiting_authorization') return '等待授权';
  return '尚未同步';
}

export function signedMetric(value: string | null) {
  const numeric = Number(value);
  if (value === null || !Number.isFinite(numeric)) return null;
  return `${numeric > 0 ? '+' : ''}${formatMetric(numeric)}`;
}
