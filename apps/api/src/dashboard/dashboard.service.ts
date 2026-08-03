import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { prisma } from '@xhs/database';
import { aggregateMetricSeries, getReportPeriod, type DataAvailability, type MetricAggregation, type ReportType } from '@xhs/domain';

export const DASHBOARD_STORE = Symbol('DASHBOARD_STORE');
const SOURCE = 'official';
function authorizedAccountWhere(source: string, now: Date) {
  return { connectorType: source, credentials: { some: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }, capabilities: { some: { enabled: true } } };
}
export function completedCollectionJobWhere(source: string, accountId: string | undefined, now: Date) {
  return { status: 'succeeded' as const, currentStage: 'complete', completedAt: { not: null }, account: authorizedAccountWhere(source, now), ...(accountId ? { accountId } : {}) };
}

type DashboardSnapshot = {
  noteId: string; noteTitle: string; accountId: string; publishedAt: Date;
  metricDefinitionId: string; metricKey: string; aggregation: MetricAggregation; availability: DataAvailability;
  value: string | null; capturedAt: Date; source: string;
  aggregationVersion?: string; windowStart?: Date | null; windowEnd?: Date | null; authoritativePeriod?: boolean;
};

export interface DashboardStore {
  isAuthorizedOfficialAccount(accountId: string, now: Date): Promise<boolean>;
  read(periodStart: Date, periodEnd: Date, source: string, accountId: string | undefined, now: Date): Promise<{
    definitions: Array<{ id: string; key: string; displayName: string; aggregation: MetricAggregation }>;
    snapshots: DashboardSnapshot[];
    lastSyncedAt: Date | null;
  }>;
}

@Injectable()
export class PrismaDashboardStore implements DashboardStore {
  async isAuthorizedOfficialAccount(accountId: string, now: Date) {
    return Boolean(await prisma.account.findFirst({ where: { id: accountId, connectorType: SOURCE, credentials: { some: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }, capabilities: { some: { enabled: true } } }, select: { id: true } }));
  }
  async read(periodStart: Date, periodEnd: Date, source: string, accountId: string | undefined, now: Date) {
    const noteWhere = { ...(accountId ? { accountId } : {}), connectorType: source, account: authorizedAccountWhere(source, now) };
    const [definitions, inPeriod, baselines, lastSync] = await Promise.all([
      prisma.metricDefinition.findMany({ where: { source, effectiveFrom: { lte: periodEnd }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: periodStart } }] }, orderBy: [{ key: 'asc' }, { effectiveFrom: 'asc' }], select: { id: true, key: true, displayName: true, aggregation: true, effectiveFrom: true, effectiveTo: true } }),
      prisma.metricSnapshot.findMany({
        where: { source, supersededAt: null, capturedAt: { gte: periodStart, lte: periodEnd }, note: noteWhere },
        orderBy: { capturedAt: 'asc' }, include: { metricDefinition: { select: { key: true, aggregation: true } }, note: { select: { id: true, title: true, accountId: true, publishedAt: true } } },
      }),
      prisma.metricSnapshot.findMany({
        where: { source, supersededAt: null, capturedAt: { lt: periodStart }, note: noteWhere },
        orderBy: { capturedAt: 'desc' }, distinct: ['noteId', 'metricDefinitionId'],
        include: { metricDefinition: { select: { key: true, aggregation: true } }, note: { select: { id: true, title: true, accountId: true, publishedAt: true } } },
      }),
      prisma.syncJob.findFirst({
        where: completedCollectionJobWhere(source, accountId, now),
        orderBy: { completedAt: 'desc' }, select: { completedAt: true },
      }),
    ]);
    const evidence = filterDashboardEvidence(definitions, [...baselines, ...inPeriod]);
    const map = (snapshot: (typeof inPeriod)[number]): DashboardSnapshot => ({
      noteId: snapshot.note.id, noteTitle: snapshot.note.title, accountId: snapshot.note.accountId, publishedAt: snapshot.note.publishedAt,
      metricDefinitionId: snapshot.metricDefinitionId, metricKey: snapshot.metricDefinition.key, aggregation: snapshot.aggregation, aggregationVersion: snapshot.aggregationVersion, windowStart: snapshot.windowStart, windowEnd: snapshot.windowEnd, authoritativePeriod: snapshot.authoritativePeriod, availability: snapshot.availability,
      value: snapshot.value?.toString() ?? null, capturedAt: snapshot.capturedAt, source: snapshot.source,
    });
    return { definitions, snapshots: evidence.map(map).sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime()), lastSyncedAt: lastSync?.completedAt ?? null };
  }
}

export function filterDashboardEvidence<D extends { id: string; effectiveFrom: Date; effectiveTo: Date | null }, S extends { metricDefinitionId: string; capturedAt: Date }>(definitions: D[], snapshots: S[]): S[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  return snapshots.filter((snapshot) => {
    const definition = byId.get(snapshot.metricDefinitionId);
    return Boolean(definition && snapshot.capturedAt >= definition.effectiveFrom && (!definition.effectiveTo || snapshot.capturedAt < definition.effectiveTo));
  });
}

type MetricValue = { key: string; aggregation: MetricAggregation; value: string | null; availability: DataAvailability };
type DeltaSnapshot = DashboardSnapshot & { delta: number | null };
const usable = (snapshot: DashboardSnapshot) => (snapshot.availability === 'available' || snapshot.availability === 'zero') && Number.isFinite(Number(snapshot.value));
const shanghaiDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

function availabilityOf(items: DashboardSnapshot[]): DataAvailability {
  const values = items.map(({ availability }) => availability);
  return values.includes('awaiting_authorization') ? 'awaiting_authorization' : values.includes('not_provided') ? 'not_provided' : 'not_synced';
}

function seriesDeltas(snapshots: DashboardSnapshot[], start: Date, cutoff: Date): DeltaSnapshot[] {
  const groups = new Map<string, DashboardSnapshot[]>();
  const compatibleKeys = new Set([...new Set(snapshots.map(({ metricKey }) => metricKey))].filter((key) => new Set(snapshots.filter((item) => item.metricKey === key).map(({ aggregation }) => aggregation)).size === 1));
  for (const item of snapshots.filter(({ capturedAt }) => capturedAt <= cutoff)) {
    const key = compatibleKeys.has(item.metricKey) ? `${item.noteId}:${item.metricKey}` : `${item.noteId}:${item.metricDefinitionId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].map((items) => {
    const aggregation = items[0]!.aggregation;
    const baseline = items.filter(({ capturedAt }) => capturedAt < start).at(-1);
    const end = items.filter(({ capturedAt }) => capturedAt >= start && capturedAt <= cutoff).at(-1);
    if (!end || (aggregation === 'cumulative_delta' && !baseline)) return { ...(end ?? baseline ?? items[0]!), delta: null };
    const inPeriod = items.filter(({ capturedAt }) => capturedAt >= start && capturedAt <= cutoff);
    const sequence = aggregation === 'cumulative_delta' ? [baseline!, ...inPeriod] : inPeriod;
    if (sequence.some((item) => !usable(item))) return { ...end, delta: null };
    return { ...end, delta: aggregateMetricSeries(aggregation, sequence.map((item) => ({ value: Number(item.value), authoritativePeriod: item.authoritativePeriod, windowStart: item.windowStart ?? undefined, windowEnd: item.windowEnd ?? undefined })), { start, endExclusive: new Date(cutoff.getTime() + 1) }) };
  });
}

function aggregate(key: string, aggregation: MetricAggregation, deltas: DeltaSnapshot[]): MetricValue {
  if (deltas.some(({ delta }) => delta === null)) return { key, aggregation, value: null, availability: availabilityOf(deltas.filter(({ delta }) => delta === null)) };
  const valid = deltas.filter(({ delta }) => delta !== null);
  if (valid.length) { const value = valid.reduce((sum, item) => sum + item.delta!, 0); return { key, aggregation, value: String(value), availability: value === 0 ? 'zero' : 'available' }; }
  return { key, aggregation, value: null, availability: availabilityOf(deltas) };
}

function buildTrend(snapshots: DashboardSnapshot[], start: Date, end: Date, definitions: Array<{ key: string; aggregation: MetricAggregation }>) {
  const dates = [...new Set(snapshots.filter(({ capturedAt }) => capturedAt >= start && capturedAt <= end).map(({ capturedAt }) => shanghaiDate(capturedAt)))].sort();
  return dates.map((date) => {
    const cutoff = new Date(`${date}T23:59:59.999+08:00`);
    const deltas = seriesDeltas(snapshots, start, cutoff);
    return { date, metrics: definitions.map(({ key, aggregation }) => aggregate(key, aggregation, deltas.filter((item) => item.metricKey === key))) };
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
    if (accountId && !(await this.store.isAuthorizedOfficialAccount(accountId, now))) throw new BadRequestException('account is not an active authorized official account');
    const reportPeriod = getReportPeriod(period as ReportType, now);
    const data = await this.store.read(reportPeriod.start, reportPeriod.end, source, accountId, now);
    if (data.snapshots.some((item) => item.source !== source)) throw new BadRequestException('mixed dashboard sources are not allowed');
    const definitionMap = new Map(data.definitions.map((item) => [item.key, item]));
    for (const item of data.snapshots) definitionMap.set(item.metricKey, { id: item.metricDefinitionId, key: item.metricKey, displayName: definitionMap.get(item.metricKey)?.displayName ?? item.metricKey, aggregation: item.aggregation });
    const definitions = [...definitionMap.values()].sort((a, b) => a.key.localeCompare(b.key));
    const deltas = seriesDeltas(data.snapshots, reportPeriod.start, reportPeriod.end);
    return {
      period, periodStart: reportPeriod.start.toISOString(), periodEnd: reportPeriod.end.toISOString(), source,
      lastSyncedAt: data.lastSyncedAt?.toISOString() ?? null,
      cards: definitions.map(({ key, aggregation }) => aggregate(key, aggregation, deltas.filter((item) => item.metricKey === key))),
      trend: buildTrend(data.snapshots, reportPeriod.start, reportPeriod.end, definitions), rankedNotes: buildRanking(deltas, new Map(data.definitions.map(({ key, displayName }) => [key, displayName]))),
    };
  }
}
