import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { prisma } from '@xhs/database';
import { aggregateMetricSeries, getCompletedMonthToDatePeriod, getReportPeriod, type DataAvailability, type MetricAggregation, type ReportType } from '@xhs/domain';

export const DASHBOARD_STORE = Symbol('DASHBOARD_STORE');
const SOURCE = 'official';
function readableAccountWhere(source: string, now: Date) {
  return source === SOURCE
    ? { connectorType: source, credentials: { some: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }, capabilities: { some: { enabled: true } } }
    : { connectorType: source };
}
export function completedCollectionJobWhere(source: string, accountId: string | undefined, now: Date) {
  return { status: 'succeeded' as const, currentStage: 'complete', completedAt: { not: null }, account: readableAccountWhere(source, now), ...(accountId ? { accountId } : {}) };
}

type DashboardSnapshot = {
  noteId: string; noteTitle: string; accountId: string; publishedAt: Date;
  metricDefinitionId: string; metricKey: string; aggregation: MetricAggregation; availability: DataAvailability;
  value: string | null; capturedAt: Date; source: string;
  aggregationVersion?: string; windowStart?: Date | null; windowEnd?: Date | null; authoritativePeriod?: boolean;
};

export interface DashboardStore {
  isReadableAccount(accountId: string, source: string, now: Date): Promise<boolean>;
  read(periodStart: Date, periodEnd: Date, source: string, accountId: string | undefined, now: Date): Promise<{
    definitions: Array<{ id: string; key: string; displayName: string; aggregation: MetricAggregation; effectiveFrom?: Date; effectiveTo?: Date | null }>;
    snapshots: DashboardSnapshot[];
    notes: Array<{ id: string; publishedAt: Date }>;
    lastSyncedAt: Date | null;
  }>;
}

@Injectable()
export class PrismaDashboardStore implements DashboardStore {
  async isReadableAccount(accountId: string, source: string, now: Date) {
    return Boolean(await prisma.account.findFirst({ where: { id: accountId, ...readableAccountWhere(source, now) }, select: { id: true } }));
  }
  async read(periodStart: Date, periodEnd: Date, source: string, accountId: string | undefined, now: Date) {
    const noteWhere = { ...(accountId ? { accountId } : {}), connectorType: source, account: readableAccountWhere(source, now) };
    const [definitions, inPeriod, baselines, notes, lastSync] = await Promise.all([
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
      prisma.note.findMany({ where: { ...noteWhere, publishedAt: { gte: periodStart, lte: periodEnd } }, select: { id: true, publishedAt: true } }),
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
    return { definitions, snapshots: evidence.map(map).sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime()), notes, lastSyncedAt: lastSync?.completedAt ?? null };
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

function seriesDeltas(snapshots: DashboardSnapshot[], start: Date, cutoff: Date, definitions: Array<{ id: string; effectiveFrom?: Date; effectiveTo?: Date | null }>): DeltaSnapshot[] {
  const groups = new Map<string, DashboardSnapshot[]>();
  for (const item of snapshots.filter(({ capturedAt }) => capturedAt <= cutoff)) {
    const key = `${item.noteId}:${item.metricDefinitionId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].map((items) => {
    const aggregation = items[0]!.aggregation;
    const definition = definitions.find(({ id }) => id === items[0]!.metricDefinitionId);
    const segmentStart = definition?.effectiveFrom && definition.effectiveFrom > start ? definition.effectiveFrom : start;
    const segmentEnd = definition?.effectiveTo && definition.effectiveTo <= cutoff ? new Date(definition.effectiveTo.getTime() - 1) : cutoff;
    const baseline = items.filter(({ capturedAt }) => capturedAt <= segmentStart).at(-1);
    const end = items.filter(({ capturedAt }) => capturedAt >= segmentStart && capturedAt <= segmentEnd).at(-1);
    if (!end) return { ...(baseline ?? items[0]!), delta: null };
    const inPeriod = items.filter(({ capturedAt }) => capturedAt > segmentStart && capturedAt <= segmentEnd);
    if (aggregation === 'cumulative_delta' && !baseline) {
      if (end.publishedAt < segmentStart || end.publishedAt > segmentEnd || inPeriod.some((item) => !usable(item))) return { ...end, delta: null };
      return { ...end, delta: aggregateMetricSeries(aggregation, [{ value: 0 }, ...inPeriod.map((item) => ({ value: Number(item.value) }))], { start, endExclusive: new Date(cutoff.getTime() + 1) }) };
    }
    const sequence = aggregation === 'cumulative_delta' ? [baseline!, ...inPeriod] : inPeriod;
    if (aggregation === 'cumulative_delta' && ((definition?.effectiveFrom && definition.effectiveFrom > start && baseline?.capturedAt.getTime() !== segmentStart.getTime()) || (definition?.effectiveTo && definition.effectiveTo <= cutoff && end?.capturedAt.getTime() !== segmentEnd.getTime()))) return { ...(end ?? baseline ?? items[0]!), delta: null };
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

function buildTrend(snapshots: DashboardSnapshot[], start: Date, end: Date, segments: Array<{ id: string; key: string; aggregation: MetricAggregation; effectiveFrom?: Date; effectiveTo?: Date | null }>, definitions: Array<{ key: string; aggregation: MetricAggregation }>) {
  const dates = [...new Set(snapshots.filter(({ capturedAt }) => capturedAt >= start && capturedAt <= end).map(({ capturedAt }) => shanghaiDate(capturedAt)))].sort();
  return dates.map((date) => {
    const cutoff = new Date(`${date}T23:59:59.999+08:00`);
    const deltas = seriesDeltas(snapshots, start, cutoff, segments);
    return { date, metrics: definitions.map(({ key, aggregation }) => aggregate(key, aggregation, deltas.filter((item) => item.metricKey === key))) };
  });
}

function dailyDates(start: Date, end: Date) {
  if (end < start) return [];
  const dates: string[] = [];
  const cursor = new Date(`${shanghaiDate(start)}T00:00:00+08:00`);
  while (cursor <= end) {
    dates.push(shanghaiDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function buildDailyRows(snapshots: DashboardSnapshot[], notes: Array<{ id: string; publishedAt: Date }>, start: Date, end: Date, segments: Array<{ id: string; key: string; aggregation: MetricAggregation; effectiveFrom?: Date; effectiveTo?: Date | null }>, definitions: Array<{ key: string; aggregation: MetricAggregation }>) {
  const rows = dailyDates(start, end).map((date) => {
    const dayStart = new Date(`${date}T00:00:00.000+08:00`);
    const dayEnd = new Date(`${date}T23:59:59.999+08:00`);
    const deltas = seriesDeltas(snapshots, dayStart, dayEnd, segments);
    const noteCount = notes.filter(({ publishedAt }) => shanghaiDate(publishedAt) === date).length;
    return { date, metrics: [
      { key: 'notes', aggregation: 'sum_interval' as const, value: String(noteCount), availability: noteCount === 0 ? 'zero' as const : 'available' as const },
      ...definitions.map(({ key, aggregation }) => aggregate(key, aggregation, deltas.filter((item) => item.metricKey === key))),
    ] };
  });
  return rows.map((row, index) => ({
    ...row,
    deltas: row.metrics.map((metric) => {
      const previous = rows[index - 1]?.metrics.find(({ key }) => key === metric.key);
      const currentUsable = (metric.availability === 'available' || metric.availability === 'zero') && metric.value !== null;
      const previousUsable = previous && (previous.availability === 'available' || previous.availability === 'zero') && previous.value !== null;
      if (!currentUsable || !previousUsable) return { key: metric.key, value: null, availability: currentUsable ? 'not_synced' as const : metric.availability };
      const value = Number(metric.value) - Number(previous.value);
      return { key: metric.key, value: String(value), availability: value === 0 ? 'zero' as const : 'available' as const };
    }),
  }));
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
    if (![SOURCE, 'self-scrape'].includes(source)) throw new BadRequestException('dashboard source is not supported');
    if (accountId && !(await this.store.isReadableAccount(accountId, source, now))) throw new BadRequestException('account is not readable for the selected dashboard source');
    const reportPeriod = period === 'daily' ? getCompletedMonthToDatePeriod(now) : getReportPeriod(period as ReportType, now);
    const data = await this.store.read(reportPeriod.start, reportPeriod.end, source, accountId, now);
    if (data.snapshots.some((item) => item.source !== source)) throw new BadRequestException('mixed dashboard sources are not allowed');
    const definitionMap = new Map<string, { key: string; displayName: string; aggregation: MetricAggregation }>();
    for (const item of data.definitions) if (!definitionMap.has(item.key)) definitionMap.set(item.key, { key: item.key, displayName: item.displayName, aggregation: item.aggregation });
    for (const item of data.snapshots) if (!definitionMap.has(item.metricKey)) definitionMap.set(item.metricKey, { key: item.metricKey, displayName: item.metricKey, aggregation: item.aggregation });
    const definitions = [...definitionMap.values()].sort((a, b) => a.key.localeCompare(b.key));
    const deltas = seriesDeltas(data.snapshots, reportPeriod.start, reportPeriod.end, data.definitions);
    const dailyRows = period === 'daily' ? buildDailyRows(data.snapshots, data.notes, reportPeriod.start, reportPeriod.end, data.definitions, definitions) : [];
    const cards = period === 'daily' ? dailyRows.at(-1)?.metrics ?? definitions.map(({ key, aggregation }) => ({ key, aggregation, value: null, availability: 'not_synced' as const })) : definitions.map(({ key, aggregation }) => aggregate(key, aggregation, deltas.filter((item) => item.metricKey === key)));
    return {
      period, periodStart: reportPeriod.start.toISOString(), periodEnd: reportPeriod.end.toISOString(), source,
      lastSyncedAt: data.lastSyncedAt?.toISOString() ?? null,
      cards, dailyRows,
      trend: buildTrend(data.snapshots, reportPeriod.start, reportPeriod.end, data.definitions, definitions), rankedNotes: buildRanking(deltas, new Map(data.definitions.map(({ key, displayName }) => [key, displayName]))),
    };
  }
}
