import { aggregateMetricSeriesWithTrace, getReportPeriod, type MetricAggregation, type ReportType } from '@xhs/domain';
import type { DatabaseClient } from '@xhs/database';

export type ReportStatus = 'complete' | 'awaiting_data';
export interface MissingReportField { noteId: string; metricDefinitionId: string | null; date: string; metricKey?: string; reason?: 'metric_definition_missing' | 'aggregation_unavailable' | 'metric_definition_transition' }
export interface DefinitionSegment { id: string; aggregation: MetricAggregation; effectiveFrom: Date; effectiveTo: Date | null }
export interface RequiredMetricDefinition { key: 'views' | 'likes' | 'comments'; id?: string; aggregation?: MetricAggregation; effectiveFrom?: Date; effectiveTo?: Date | null; segments?: DefinitionSegment[] }

export interface CumulativeSnapshot {
  id?: string;
  revision?: number;
  metricDefinitionId: string;
  noteId: string;
  capturedAt: Date;
  value: number;
  aggregation?: MetricAggregation;
  aggregationVersion?: string;
  windowStart?: Date | null;
  windowEnd?: Date | null;
  authoritativePeriod?: boolean;
  metricKey?: string;
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
  evidenceRefs?: Array<{ snapshotId: string; revision: number }>;
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
  listRequiredMetricDefinitions(start?: Date, end?: Date): Promise<RequiredMetricDefinition[]>;
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
        this.store.listNoteIds(accountId), this.store.listRequiredMetricDefinitions(period.start, period.end),
      ]);
      const transitions = metricDefinitions.filter(({ segments }) => segments && new Set(segments.map(({ aggregation }) => aggregation)).size > 1);
      const transitionKeys = new Set(transitions.map(({ key }) => key));
      const effectiveDefinitions = metricDefinitions.flatMap((definition) => {
        if (definition.segments?.length && new Set(definition.segments.map(({ aggregation }) => aggregation)).size === 1) {
          return definition.segments.map((segment) => ({ key: definition.key, id: segment.id, aggregation: segment.aggregation, effectiveFrom: segment.effectiveFrom, effectiveTo: segment.effectiveTo }));
        }
        const historical = snapshots.find((snapshot) => snapshot.metricKey === definition.key);
        return [historical ? { ...definition, id: historical.metricDefinitionId, aggregation: historical.aggregation } : definition];
      });
      const missingFields: MissingReportField[] = [];
      for (const definition of transitions) for (const noteId of noteIds) missingFields.push({ noteId, metricKey: definition.key, metricDefinitionId: definition.segments![0]!.id, date: requiredDates[0]!, reason: 'metric_definition_transition' });
      missingFields.push(...findMissingFields(noteIds, effectiveDefinitions.filter(({ key }) => !transitionKeys.has(key)), requiredDates, snapshots));
      const aggregation = aggregateByMetric(noteIds, effectiveDefinitions, snapshots, period.start, period.end);
      for (const missing of aggregation.missing) if (!missingFields.some((item) => item.noteId === missing.noteId && item.metricDefinitionId === missing.metricDefinitionId)) missingFields.push({ ...missing, date: requiredDates[0]!, reason: 'aggregation_unavailable' });
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
        metrics: reportStatus === 'complete' ? aggregation.metrics : [],
        evidenceRefs: reportStatus === 'complete' ? aggregation.usedEvidenceIds.map((id) => {
          const evidence = snapshots.find((snapshot) => snapshot.id === id)!;
          return { snapshotId: id, revision: evidence.revision! };
        }) : [],
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
  for (const noteId of noteIds) for (const definition of metricDefinitions) for (const date of dates.filter((candidate) => definitionIntersectsDate(definition, candidate))) {
    if (!definition.id) {
      missing.push({ noteId, metricKey: definition.key, metricDefinitionId: null, date, reason: 'metric_definition_missing' });
      continue;
    }
    const metricDefinitionId = definition.id;
    if ((definition.aggregation ?? 'cumulative_delta') !== 'cumulative_delta') continue;
    if (!counts.has(`${noteId}\0${metricDefinitionId}\0${date}`)) missing.push({ noteId, metricDefinitionId, date });
  }
  for (const noteId of noteIds) for (const { id: metricDefinitionId } of metricDefinitions) {
    if (!metricDefinitionId) continue;
    const definition = metricDefinitions.find(({ id }) => id === metricDefinitionId);
    if ((definition?.aggregation ?? 'cumulative_delta') !== 'cumulative_delta') continue;
    const seriesKey = `${noteId}\0${metricDefinitionId}`;
    if ((seriesCounts.get(seriesKey) ?? 0) < 2 && !missing.some((field) => field.noteId === noteId && field.metricDefinitionId === metricDefinitionId)) {
      missing.push({ noteId, metricDefinitionId, date: dates[0]! });
    }
  }
  return missing;
}

function definitionIntersectsDate(definition: RequiredMetricDefinition, date: string) {
  const dayStart = new Date(`${date}T00:00:00+08:00`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  return (!definition.effectiveTo || definition.effectiveTo > dayStart) && (!definition.effectiveFrom || definition.effectiveFrom < dayEnd);
}

export class PrismaReportStore implements ReportStore {
  constructor(private readonly db: DatabaseClient) {}

  async listAccountIds() {
    return (await this.db.account.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(({ id }) => id);
  }

  async listNoteIds(accountId: string) {
    return (await this.db.note.findMany({ where: { accountId }, select: { id: true }, orderBy: { id: 'asc' } })).map(({ id }) => id);
  }

  async listRequiredMetricDefinitions(start = new Date(0), end = new Date(8640000000000000)): Promise<RequiredMetricDefinition[]> {
    const rows = await this.db.metricDefinition.findMany({
      where: { key: { in: ['views', 'likes', 'comments'] }, source: { in: ['legacy', 'official'] }, effectiveFrom: { lte: end }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: start } }] },
      orderBy: [{ key: 'asc' }, { effectiveFrom: 'asc' }], select: { id: true, key: true, source: true, aggregation: true, effectiveFrom: true, effectiveTo: true },
    });
    return (['views', 'likes', 'comments'] as const).flatMap((key) => {
      const keyRows = rows.filter((row) => row.key === key);
      const selected = keyRows.some((row) => row.source === 'official') ? keyRows.filter((row) => row.source === 'official') : keyRows;
      const segments = selected.map(({ id, aggregation, effectiveFrom, effectiveTo }) => ({ id, aggregation, effectiveFrom, effectiveTo }));
      return segments.length ? [{ key, id: segments[0]!.id, aggregation: segments[0]!.aggregation, segments }] : [];
    });
  }

  async loadCumulativeMetrics(accountId: string, start: Date, end: Date) {
    const select = { id: true, revision: true, metricDefinitionId: true, noteId: true, capturedAt: true, value: true, aggregation: true, aggregationVersion: true, windowStart: true, windowEnd: true, authoritativePeriod: true, metricDefinition: { select: { key: true } } } as const;
    const [inside, baselines] = await Promise.all([
      this.db.metricSnapshot.findMany({ where: { note: { accountId }, source: 'official', supersededAt: null, capturedAt: { gte: start, lte: end }, availability: 'available', value: { not: null } }, select, orderBy: { capturedAt: 'asc' } }),
      this.db.metricSnapshot.findMany({ where: { note: { accountId }, source: 'official', supersededAt: null, capturedAt: { lt: start }, availability: 'available', value: { not: null }, aggregation: 'cumulative_delta' }, select, orderBy: { capturedAt: 'desc' }, distinct: ['noteId', 'metricDefinitionId'] }),
    ]);
    return [...baselines, ...inside].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime()).map(({ metricDefinition, ...snapshot }) => ({ ...snapshot, metricKey: metricDefinition.key, value: Number(snapshot.value) }));
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
          evidenceRefs: input.evidenceRefs ?? [],
        },
        select: { id: true, accountId: true, version: true, status: true },
      });
    });
  }
}

function aggregateByMetric(noteIds: string[], definitions: RequiredMetricDefinition[], snapshots: CumulativeSnapshot[], start: Date, end: Date) {
  const groups = new Map<string, Map<string, CumulativeSnapshot[]>>();
  for (const snapshot of snapshots) {
    const notes = groups.get(snapshot.metricDefinitionId) ?? new Map<string, CumulativeSnapshot[]>();
    notes.set(snapshot.noteId, [...(notes.get(snapshot.noteId) ?? []), snapshot]);
    groups.set(snapshot.metricDefinitionId, notes);
  }
  const metrics: Array<{ metricDefinitionId: string; value: number }> = []; const missing: Array<{ noteId: string; metricDefinitionId: string }> = []; const usedEvidenceIds = new Set<string>();
  for (const definition of definitions) {
    if (!definition.id) continue;
    const metricDefinitionId = definition.id; const notes = groups.get(metricDefinitionId) ?? new Map<string, CumulativeSnapshot[]>();
    let total = 0; let available = true;
    for (const noteId of noteIds) {
      const values = notes.get(noteId) ?? [];
      if (!values.length) { available = false; missing.push({ noteId, metricDefinitionId }); continue; }
      const segmentStart = definition.effectiveFrom && definition.effectiveFrom > start ? definition.effectiveFrom : start;
      const reportEndExclusive = new Date(end.getTime() + 1);
      const segmentEndExclusive = definition.effectiveTo && definition.effectiveTo < reportEndExclusive ? definition.effectiveTo : reportEndExclusive;
      const semantic = values[0]?.aggregation ?? definition.aggregation ?? 'cumulative_delta';
      const before = values.filter(({ capturedAt }) => capturedAt <= segmentStart).sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime()).slice(0, semantic === 'cumulative_delta' ? 1 : 0);
      const inside = values.filter(({ capturedAt }) => capturedAt >= segmentStart && capturedAt < segmentEndExclusive);
      const ordered = [...before, ...inside].filter((item, index, all) => all.findIndex(({ id, capturedAt }) => id ? id === item.id : capturedAt.getTime() === item.capturedAt.getTime()) === index).sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
      const hasRequiredBaseline = semantic !== 'cumulative_delta' || !ordered[0]?.aggregationVersion || ordered[0].capturedAt <= segmentStart;
      const transitionBoundaryComplete = semantic !== 'cumulative_delta' || ((!definition.effectiveFrom || definition.effectiveFrom <= start || ordered[0]?.capturedAt.getTime() === segmentStart.getTime()) && (!definition.effectiveTo || definition.effectiveTo >= reportEndExclusive || ordered.at(-1)?.capturedAt.getTime() === segmentEndExclusive.getTime() - 1));
      const trace = hasRequiredBaseline && transitionBoundaryComplete ? aggregateMetricSeriesWithTrace(semantic, ordered.map((item) => ({ evidenceId: item.id, value: item.value, authoritativePeriod: item.authoritativePeriod, windowStart: item.windowStart ?? undefined, windowEnd: item.windowEnd ?? undefined })), { start: segmentStart, endExclusive: segmentEndExclusive }) : { value: null, usedEvidenceIds: [] };
      if (trace.value === null) { available = false; missing.push({ noteId, metricDefinitionId }); } else { total += trace.value; trace.usedEvidenceIds.forEach((id) => usedEvidenceIds.add(id)); }
    }
    if (available) metrics.push({ metricDefinitionId, value: total });
  }
  return { metrics, missing, usedEvidenceIds: [...usedEvidenceIds] };
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
