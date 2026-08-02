import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { prisma } from '@xhs/database';
import { getReportPeriod, type DataAvailability, type ReportType } from '@xhs/domain';

export const DASHBOARD_STORE = Symbol('DASHBOARD_STORE');

type DashboardSnapshot = {
  noteId: string;
  noteTitle: string;
  accountId: string;
  publishedAt: Date;
  metricDefinitionId: string;
  metricKey: string;
  availability: DataAvailability;
  value: string | null;
  capturedAt: Date;
  source: string;
};

export interface DashboardStore {
  read(periodStart: Date, periodEnd: Date, accountId?: string): Promise<{
    definitions: Array<{ id: string; key: string }>;
    snapshots: DashboardSnapshot[];
    lastSyncedAt: Date | null;
  }>;
}

@Injectable()
export class PrismaDashboardStore implements DashboardStore {
  async read(periodStart: Date, periodEnd: Date, accountId?: string) {
    const [definitions, snapshots, lastSync] = await Promise.all([
      prisma.metricDefinition.findMany({ orderBy: { key: 'asc' }, select: { id: true, key: true } }),
      prisma.metricSnapshot.findMany({
        where: {
          capturedAt: { gte: periodStart, lte: periodEnd },
          ...(accountId ? { note: { accountId } } : {}),
        },
        orderBy: { capturedAt: 'asc' },
        include: {
          metricDefinition: { select: { key: true } },
          note: { select: { id: true, title: true, accountId: true, publishedAt: true } },
        },
      }),
      prisma.syncJob.findFirst({
        where: { status: 'succeeded', completedAt: { not: null }, ...(accountId ? { accountId } : {}) },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      }),
    ]);

    return {
      definitions,
      snapshots: snapshots.map((snapshot) => ({
        noteId: snapshot.note.id,
        noteTitle: snapshot.note.title,
        accountId: snapshot.note.accountId,
        publishedAt: snapshot.note.publishedAt,
        metricDefinitionId: snapshot.metricDefinitionId,
        metricKey: snapshot.metricDefinition.key,
        availability: snapshot.availability,
        value: snapshot.value?.toString() ?? null,
        capturedAt: snapshot.capturedAt,
        source: snapshot.source,
      })),
      lastSyncedAt: lastSync?.completedAt ?? null,
    };
  }
}

type MetricValue = { key: string; value: string | null; availability: DataAvailability };

function shanghaiDate(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function aggregate(key: string, snapshots: DashboardSnapshot[]): MetricValue {
  const numeric = snapshots
    .filter((snapshot) => snapshot.availability === 'available' || snapshot.availability === 'zero')
    .map((snapshot) => Number(snapshot.value ?? 0))
    .filter(Number.isFinite);
  if (numeric.length) {
    const value = numeric.reduce((sum, item) => sum + item, 0);
    return { key, value: String(value), availability: value === 0 ? 'zero' : 'available' };
  }
  const unavailable = snapshots.map(({ availability }) => availability);
  const availability: DataAvailability = unavailable.includes('awaiting_authorization')
    ? 'awaiting_authorization'
    : unavailable.includes('not_provided') ? 'not_provided' : 'not_synced';
  return { key, value: null, availability };
}

function latestByNoteAndMetric(snapshots: DashboardSnapshot[]) {
  const latest = new Map<string, DashboardSnapshot>();
  for (const snapshot of snapshots) latest.set(`${snapshot.noteId}:${snapshot.metricDefinitionId}`, snapshot);
  return [...latest.values()];
}

function buildTrend(snapshots: DashboardSnapshot[]) {
  const byDate = new Map<string, DashboardSnapshot[]>();
  for (const snapshot of snapshots) {
    const date = shanghaiDate(snapshot.capturedAt);
    const bucket = byDate.get(date) ?? [];
    bucket.push(snapshot);
    byDate.set(date, bucket);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, bucket]) => {
    const latest = latestByNoteAndMetric(bucket);
    const keys = [...new Set(latest.map(({ metricKey }) => metricKey))].sort();
    return { date, metrics: keys.map((key) => aggregate(key, latest.filter((snapshot) => snapshot.metricKey === key))) };
  });
}

function buildRanking(snapshots: DashboardSnapshot[]) {
  const latest = latestByNoteAndMetric(snapshots);
  const notes = new Map<string, DashboardSnapshot[]>();
  for (const snapshot of latest) {
    const bucket = notes.get(snapshot.noteId) ?? [];
    bucket.push(snapshot);
    notes.set(snapshot.noteId, bucket);
  }
  const priority = ['impressions', 'views', 'likes', 'comments', 'favorites'];
  return [...notes.values()].flatMap((bucket) => {
    const metric = priority.map((key) => bucket.find((item) => item.metricKey === key && (item.availability === 'available' || item.availability === 'zero'))).find(Boolean);
    if (!metric) return [];
    return [{
      id: metric.noteId,
      accountId: metric.accountId,
      title: metric.noteTitle,
      publishedAt: metric.publishedAt.toISOString(),
      metricKey: metric.metricKey,
      value: metric.value ?? '0',
    }];
  }).sort((a, b) => Number(b.value) - Number(a.value) || a.id.localeCompare(b.id)).slice(0, 10);
}

@Injectable()
export class DashboardService {
  constructor(@Inject(DASHBOARD_STORE) private readonly store: DashboardStore) {}

  async get(period: string, accountId?: string, now = new Date()) {
    if (!['daily', 'weekly', 'monthly'].includes(period)) throw new BadRequestException('invalid period');
    const reportPeriod = getReportPeriod(period as ReportType, now);
    const data = await this.store.read(reportPeriod.start, reportPeriod.end, accountId);
    const latest = latestByNoteAndMetric(data.snapshots);
    const keys = [...new Set([...data.definitions.map(({ key }) => key), ...latest.map(({ metricKey }) => metricKey)])].sort();
    const sources = [...new Set(data.snapshots.map(({ source }) => source))];
    return {
      period,
      periodStart: reportPeriod.start.toISOString(),
      periodEnd: reportPeriod.end.toISOString(),
      source: sources.length === 0 ? null : sources.length === 1 ? sources[0] : 'mixed',
      lastSyncedAt: data.lastSyncedAt?.toISOString() ?? null,
      cards: keys.map((key) => aggregate(key, latest.filter((snapshot) => snapshot.metricKey === key))),
      trend: buildTrend(data.snapshots),
      rankedNotes: buildRanking(data.snapshots),
    };
  }
}
