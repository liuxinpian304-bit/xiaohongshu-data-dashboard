import { aggregateMetricSeries, getReportPeriod, type MetricAggregation, type ReportType } from '@xhs/domain';
import type { DatabaseClient } from '@xhs/database';

export type ReportStatus = 'complete' | 'awaiting_data';
export interface MissingReportField { noteId: string; metricDefinitionId: string | null; date: string; metricKey?: string; reason?: 'metric_definition_missing' }
export interface RequiredMetricDefinition { key: 'views' | 'likes' | 'comments'; id?: string; aggregation?: MetricAggregation }

export interface CumulativeSnapshot {
  metricDefinitionId: string;
  noteId: string;
  capturedAt: Date;
  value: number;
  aggregation?: MetricAggregation;
}

export interface CreateReportVersionInput {
  accountId: string;
  type: ReportType;
  periodStart: Date;
  periodEnd: Date;
  status: ReportStatus;
  missingDates: string[];
  missingFields: MissingReportField[];
  metrics: Array<{ metricDefinitionId: string; value: number }>;
  backfillId?: string;
  rebuildJobId?: string;
  previousReportId?: string;
  rebuildReason?: string;
}

export interface ReportGenerationContext {
  accountId?: string;
  backfillId?: string;
  rebuildJobId?: string;
  previousReportId?: string;
  rebuildReason?: string;
}

export interface ReportStore {
  listAccountIds(): Promise<string[]>;
  listNoteIds(accountId: string): Promise<string[]>;
  listRequiredMetricDefinitions(): Promise<RequiredMetricDefinition[]>;
  loadCumulativeMetrics(accountId: string, start: Date, end: Date): Promise<CumulativeSnapshot[]>;
  createVersion(input: CreateReportVersionInput): Promise<{ id: string; accountId: string; version: number; status: string }>;
}

export interface ReportResult {
  status: ReportStatus;
  missingDates: string[];
  missingFields: MissingReportField[];
  reports: Array<{ id: string; accountId: string; version: number; status: string }>;
}

export class ReportService {
  constructor(private readonly store: ReportStore) {}

  async generateReport(type: ReportType, now: Date, context: ReportGenerationContext = {}): Promise<ReportResult> {
    const period = getReportPeriod(type, now);
    const requiredDates = calendarDates(period.start, period.end);
    const reports = [];
    const allMissing = new Set<string>();
    const allMissingFields: MissingReportField[] = [];
    let status: ReportStatus = 'complete';

    const accountIds = context.accountId ? [context.accountId] : await this.store.listAccountIds();
    for (const accountId of accountIds) {
      const snapshots = await this.store.loadCumulativeMetrics(accountId, period.start, period.end);
      const [noteIds, metricDefinitions] = await Promise.all([
        this.store.listNoteIds(accountId), this.store.listRequiredMetricDefinitions(),
      ]);
      const missingFields = findMissingFields(noteIds, metricDefinitions, requiredDates, snapshots);
      const missingDates = [...new Set(missingFields.map((field) => field.date))].sort();
      const reportStatus: ReportStatus = missingDates.length ? 'awaiting_data' : 'complete';
      if (reportStatus === 'awaiting_data') status = reportStatus;
      missingDates.forEach((date) => allMissing.add(date));
      allMissingFields.push(...missingFields);
      reports.push(await this.store.createVersion({
        accountId,
        type,
        periodStart: period.start,
        periodEnd: period.end,
        status: reportStatus,
        missingDates,
        missingFields,
        backfillId: context.backfillId,
        rebuildJobId: context.rebuildJobId,
        previousReportId: context.previousReportId,
        rebuildReason: context.rebuildReason,
        metrics: reportStatus === 'complete' ? aggregateByMetric(snapshots) : [],
      }));
    }

    return { status, missingDates: [...allMissing].sort(), missingFields: allMissingFields, reports };
  }
}

function findMissingFields(noteIds: string[], metricDefinitions: RequiredMetricDefinition[], dates: string[], snapshots: CumulativeSnapshot[]) {
  const counts = new Map<string, number>();
  const seriesCounts = new Map<string, number>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.noteId}\0${snapshot.metricDefinitionId}\0${shanghaiDate(snapshot.capturedAt)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const seriesKey = `${snapshot.noteId}\0${snapshot.metricDefinitionId}`;
    seriesCounts.set(seriesKey, (seriesCounts.get(seriesKey) ?? 0) + 1);
  }
  const missing: MissingReportField[] = [];
  for (const noteId of noteIds) for (const definition of metricDefinitions) for (const date of dates) {
    if (!definition.id) {
      missing.push({ noteId, metricKey: definition.key, metricDefinitionId: null, date, reason: 'metric_definition_missing' });
      continue;
    }
    const metricDefinitionId = definition.id;
    if (!counts.has(`${noteId}\0${metricDefinitionId}\0${date}`)) missing.push({ noteId, metricDefinitionId, date });
  }
  for (const noteId of noteIds) for (const { id: metricDefinitionId } of metricDefinitions) {
    if (!metricDefinitionId) continue;
    const seriesKey = `${noteId}\0${metricDefinitionId}`;
    if ((seriesCounts.get(seriesKey) ?? 0) < 2 && !missing.some((field) => field.noteId === noteId && field.metricDefinitionId === metricDefinitionId)) {
      missing.push({ noteId, metricDefinitionId, date: dates[0]! });
    }
  }
  return missing;
}

export class PrismaReportStore implements ReportStore {
  constructor(private readonly db: DatabaseClient) {}

  async listAccountIds() {
    return (await this.db.account.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(({ id }) => id);
  }

  async listNoteIds(accountId: string) {
    return (await this.db.note.findMany({ where: { accountId }, select: { id: true }, orderBy: { id: 'asc' } })).map(({ id }) => id);
  }

  async listRequiredMetricDefinitions(): Promise<RequiredMetricDefinition[]> {
    const byKey = new Map((await this.db.metricDefinition.findMany({
      where: { key: { in: ['views', 'likes', 'comments'] } }, select: { id: true, key: true, aggregation: true },
    })).map((definition) => [definition.key, definition]));
    return (['views', 'likes', 'comments'] as const).map((key) => ({ key, id: byKey.get(key)?.id, aggregation: byKey.get(key)?.aggregation }));
  }

  async loadCumulativeMetrics(accountId: string, start: Date, end: Date) {
    const snapshots = await this.db.metricSnapshot.findMany({
      where: { note: { accountId }, capturedAt: { gte: start, lte: end }, availability: 'available', value: { not: null } },
      select: { metricDefinitionId: true, noteId: true, capturedAt: true, value: true, metricDefinition: { select: { aggregation: true } } },
      orderBy: { capturedAt: 'asc' },
    });
    return snapshots.map((snapshot) => ({ metricDefinitionId: snapshot.metricDefinitionId, noteId: snapshot.noteId, capturedAt: snapshot.capturedAt, value: Number(snapshot.value), aggregation: snapshot.metricDefinition.aggregation }));
  }

  async createVersion(input: CreateReportVersionInput) {
    return this.db.$transaction(async (tx) => {
      const scope = `${input.accountId}:${input.type}:${input.periodStart.toISOString()}:${input.periodEnd.toISOString()}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}))`;
      const latest = await tx.report.findFirst({
        where: { accountId: input.accountId, reportType: input.type, periodStart: input.periodStart, periodEnd: input.periodEnd },
        orderBy: { version: 'desc' }, select: { id: true, version: true },
      });
      return tx.report.create({
        data: {
          accountId: input.accountId, reportType: input.type, periodStart: input.periodStart, periodEnd: input.periodEnd,
          version: (latest?.version ?? 0) + 1, status: input.status, missingDates: input.missingDates,
          missingFields: input.missingFields.map((field) => ({ ...field })),
          backfillId: input.backfillId, rebuildJobId: input.rebuildJobId,
          previousReportId: input.previousReportId ?? latest?.id, rebuildReason: input.rebuildReason,
          metrics: { create: input.metrics.map((metric) => ({
            metricDefinitionId: metric.metricDefinitionId, availability: 'available', value: metric.value,
          })) },
        },
        select: { id: true, accountId: true, version: true, status: true },
      });
    });
  }
}

function aggregateByMetric(snapshots: CumulativeSnapshot[]) {
  const groups = new Map<string, Map<string, CumulativeSnapshot[]>>();
  for (const snapshot of snapshots) {
    const notes = groups.get(snapshot.metricDefinitionId) ?? new Map<string, CumulativeSnapshot[]>();
    notes.set(snapshot.noteId, [...(notes.get(snapshot.noteId) ?? []), snapshot]);
    groups.set(snapshot.metricDefinitionId, notes);
  }
  return [...groups].map(([metricDefinitionId, notes]) => ({
    metricDefinitionId,
    value: [...notes.values()].reduce((total, values) => total + (aggregateMetricSeries(
      values[0]?.aggregation ?? 'cumulative_delta',
      values.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime()).map((item) => ({ value: item.value })),
    ) ?? 0), 0),
  }));
}

function calendarDates(start: Date, end: Date): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${shanghaiDate(start)}T00:00:00+08:00`);
  const last = shanghaiDate(end);
  while (shanghaiDate(cursor) <= last) {
    dates.push(shanghaiDate(cursor));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return dates;
}

function shanghaiDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}
