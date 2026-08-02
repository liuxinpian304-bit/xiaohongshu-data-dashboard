import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { prisma } from '@xhs/database';
import { getReportPeriod, type DataAvailability, type ReportType } from '@xhs/domain';

export const DASHBOARD_STORE = Symbol('DASHBOARD_STORE');
const SOURCE = 'official';
export function completedCollectionJobWhere(source: string, accountId?: string) {
  return { status: 'succeeded' as const, currentStage: 'complete', completedAt: { not: null }, account: { connectorType: source }, ...(accountId ? { accountId } : {}) };
}

type DashboardSnapshot = {
  noteId: string; noteTitle: string; accountId: string; publishedAt: Date;
  metricDefinitionId: string; metricKey: string; availability: DataAvailability;
  value: string | null; capturedAt: Date; source: string;
};

export interface DashboardStore {
  read(periodStart: Date, periodEnd: Date, source: string, accountId?: string): Promise<{
    definitions: Array<{ id: string; key: string; displayName: string }>;
    snapshots: DashboardSnapshot[];
    lastSyncedAt: Date | null;
  }>;
}

@Injectable()
export class PrismaDashboardStore implements DashboardStore {
  async read(periodStart: Date, periodEnd: Date, source: string, accountId?: string) {
    const noteWhere = { ...(accountId ? { accountId } : {}), connectorType: source };
    const [definitions, inPeriod, baselines, lastSync] = await Promise.all([
      prisma.metricDefinition.findMany({ orderBy: { key: 'asc' }, select: { id: true, key: true, displayName: true } }),
      prisma.metricSnapshot.findMany({
        where: { source, capturedAt: { gte: periodStart, lte: periodEnd }, note: noteWhere },
        orderBy: { capturedAt: 'asc' }, include: { metricDefinition: { select: { key: true } }, note: { select: { id: true, title: true, accountId: true, publishedAt: true } } },
      }),
      prisma.metricSnapshot.findMany({
        where: { source, capturedAt: { lt: periodStart }, note: noteWhere },
        orderBy: { capturedAt: 'desc' }, distinct: ['noteId', 'metricDefinitionId'],
        include: { metricDefinition: { select: { key: true } }, note: { select: { id: true, title: true, accountId: true, publishedAt: true } } },
      }),
      prisma.syncJob.findFirst({
        where: completedCollectionJobWhere(source, accountId),
        orderBy: { completedAt: 'desc' }, select: { completedAt: true },
      }),
    ]);
    const map = (snapshot: (typeof inPeriod)[number]): DashboardSnapshot => ({
      noteId: snapshot.note.id, noteTitle: snapshot.note.title, accountId: snapshot.note.accountId, publishedAt: snapshot.note.publishedAt,
      metricDefinitionId: snapshot.metricDefinitionId, metricKey: snapshot.metricDefinition.key, availability: snapshot.availability,
      value: snapshot.value?.toString() ?? null, capturedAt: snapshot.capturedAt, source: snapshot.source,
    });
    return { definitions, snapshots: [...baselines.map(map), ...inPeriod.map(map)].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime()), lastSyncedAt: lastSync?.completedAt ?? null };
  }
}

type MetricValue = { key: string; value: string | null; availability: DataAvailability };
type DeltaSnapshot = DashboardSnapshot & { delta: number | null };
const usable = (snapshot: DashboardSnapshot) => (snapshot.availability === 'available' || snapshot.availability === 'zero') && Number.isFinite(Number(snapshot.value));
const shanghaiDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

function availabilityOf(items: DashboardSnapshot[]): DataAvailability {
  const values = items.map(({ availability }) => availability);
  return values.includes('awaiting_authorization') ? 'awaiting_authorization' : values.includes('not_provided') ? 'not_provided' : 'not_synced';
}

function seriesDeltas(snapshots: DashboardSnapshot[], start: Date, cutoff: Date): DeltaSnapshot[] {
  const groups = new Map<string, DashboardSnapshot[]>();
  for (const item of snapshots.filter(({ capturedAt }) => capturedAt <= cutoff)) {
    const key = `${item.noteId}:${item.metricDefinitionId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].map((items) => {
    const baseline = items.filter(({ capturedAt }) => capturedAt < start).at(-1);
    const end = items.filter(({ capturedAt }) => capturedAt >= start && capturedAt <= cutoff).at(-1);
    if (!baseline || !end || !usable(baseline) || !usable(end)) return { ...(end ?? baseline ?? items[0]!), delta: null };
    const sequence = [baseline, ...items.filter(({ capturedAt }) => capturedAt >= start && capturedAt <= cutoff)];
    if (sequence.some((item) => !usable(item))) return { ...end, delta: null };
    let delta = 0;
    for (let index = 1; index < sequence.length; index += 1) {
      const before = Number(sequence[index - 1]!.value); const after = Number(sequence[index]!.value);
      delta += after >= before ? after - before : after;
    }
    return { ...end, delta };
  });
}

function aggregate(key: string, deltas: DeltaSnapshot[]): MetricValue {
  if (deltas.some(({ delta }) => delta === null)) return { key, value: null, availability: availabilityOf(deltas.filter(({ delta }) => delta === null)) };
  const valid = deltas.filter(({ delta }) => delta !== null);
  if (valid.length) { const value = valid.reduce((sum, item) => sum + item.delta!, 0); return { key, value: String(value), availability: value === 0 ? 'zero' : 'available' }; }
  return { key, value: null, availability: availabilityOf(deltas) };
}

function buildTrend(snapshots: DashboardSnapshot[], start: Date, end: Date, keys: string[]) {
  const dates = [...new Set(snapshots.filter(({ capturedAt }) => capturedAt >= start && capturedAt <= end).map(({ capturedAt }) => shanghaiDate(capturedAt)))].sort();
  return dates.map((date) => {
    const cutoff = new Date(`${date}T23:59:59.999+08:00`);
    const deltas = seriesDeltas(snapshots, start, cutoff);
    return { date, metrics: keys.map((key) => aggregate(key, deltas.filter((item) => item.metricKey === key))) };
  });
}

function buildRanking(deltas: DeltaSnapshot[], labels: Map<string, string>) {
  const priority = ['impressions', 'views', 'likes', 'comments', 'favorites'];
  const candidateIds = [...new Set(deltas.filter(({ delta }) => delta !== null).map(({ noteId }) => noteId))];
  const availableKeys = [...new Set(deltas.filter(({ delta }) => delta !== null).map(({ metricKey }) => metricKey))];
  const comparable = (key: string) => candidateIds.every((noteId) => deltas.some((item) => item.noteId === noteId && item.metricKey === key && item.delta !== null));
  const metricKey = priority.find((key) => comparable(key)) ?? availableKeys.sort().find(comparable);
  if (!metricKey) return [];
  return deltas.filter((item) => item.metricKey === metricKey && item.delta !== null).map((item) => ({
    id: item.noteId, accountId: item.accountId, title: item.noteTitle, publishedAt: item.publishedAt.toISOString(), metricKey, metricLabel: labels.get(metricKey) ?? metricKey, value: String(item.delta),
  })).sort((a, b) => Number(b.value) - Number(a.value) || a.id.localeCompare(b.id)).slice(0, 10);
}

@Injectable()
export class DashboardService {
  constructor(@Inject(DASHBOARD_STORE) private readonly store: DashboardStore) {}
  async get(period: string, accountId?: string, source = SOURCE, now = new Date()) {
    if (!['daily', 'weekly', 'monthly'].includes(period)) throw new BadRequestException('invalid period');
    if (source !== SOURCE) throw new BadRequestException('dashboard source must be official');
    const reportPeriod = getReportPeriod(period as ReportType, now);
    const data = await this.store.read(reportPeriod.start, reportPeriod.end, source, accountId);
    if (data.snapshots.some((item) => item.source !== source)) throw new BadRequestException('mixed dashboard sources are not allowed');
    const keys = [...new Set([...data.definitions.map(({ key }) => key), ...data.snapshots.map(({ metricKey }) => metricKey)])].sort();
    const deltas = seriesDeltas(data.snapshots, reportPeriod.start, reportPeriod.end);
    return {
      period, periodStart: reportPeriod.start.toISOString(), periodEnd: reportPeriod.end.toISOString(), source,
      lastSyncedAt: data.lastSyncedAt?.toISOString() ?? null,
      cards: keys.map((key) => aggregate(key, deltas.filter((item) => item.metricKey === key))),
      trend: buildTrend(data.snapshots, reportPeriod.start, reportPeriod.end, keys), rankedNotes: buildRanking(deltas, new Map(data.definitions.map(({ key, displayName }) => [key, displayName]))),
    };
  }
}
