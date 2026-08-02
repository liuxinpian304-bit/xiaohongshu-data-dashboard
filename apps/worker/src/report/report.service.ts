import { aggregateCumulative, getReportPeriod, type ReportType } from '@xhs/domain';
import type { DatabaseClient } from '@xhs/database';

export type ReportStatus = 'complete' | 'awaiting_data';

export interface CumulativeSnapshot {
  metricDefinitionId: string;
  noteId: string;
  capturedAt: Date;
  value: number;
}

export interface CreateReportVersionInput {
  accountId: string;
  type: ReportType;
  periodStart: Date;
  periodEnd: Date;
  status: ReportStatus;
  missingDates: string[];
  metrics: Array<{ metricDefinitionId: string; value: number }>;
}

export interface ReportStore {
  listAccountIds(): Promise<string[]>;
  loadCumulativeMetrics(accountId: string, start: Date, end: Date): Promise<CumulativeSnapshot[]>;
  createVersion(input: CreateReportVersionInput): Promise<{ accountId: string; version: number; status: string }>;
}

export interface ReportResult {
  status: ReportStatus;
  missingDates: string[];
  reports: Array<{ accountId: string; version: number; status: string }>;
}

export class ReportService {
  constructor(private readonly store: ReportStore) {}

  async generateReport(type: ReportType, now: Date): Promise<ReportResult> {
    const period = getReportPeriod(type, now);
    const requiredDates = calendarDates(period.start, period.end);
    const reports = [];
    const allMissing = new Set<string>();
    let status: ReportStatus = 'complete';

    for (const accountId of await this.store.listAccountIds()) {
      const snapshots = await this.store.loadCumulativeMetrics(accountId, period.start, period.end);
      const present = new Set(snapshots.map((snapshot) => shanghaiDate(snapshot.capturedAt)));
      const missingDates = requiredDates.filter((date) => !present.has(date));
      if (hasIncompleteSeries(snapshots) && missingDates.length === 0) missingDates.push(requiredDates[0]!);
      const reportStatus: ReportStatus = missingDates.length ? 'awaiting_data' : 'complete';
      if (reportStatus === 'awaiting_data') status = reportStatus;
      missingDates.forEach((date) => allMissing.add(date));
      reports.push(await this.store.createVersion({
        accountId,
        type,
        periodStart: period.start,
        periodEnd: period.end,
        status: reportStatus,
        missingDates,
        metrics: reportStatus === 'complete' ? aggregateByMetric(snapshots) : [],
      }));
    }

    return { status, missingDates: [...allMissing].sort(), reports };
  }
}

function hasIncompleteSeries(snapshots: CumulativeSnapshot[]): boolean {
  const counts = new Map<string, number>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.metricDefinitionId}:${snapshot.noteId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count < 2);
}

export class PrismaReportStore implements ReportStore {
  constructor(private readonly db: DatabaseClient) {}

  async listAccountIds() {
    return (await this.db.account.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(({ id }) => id);
  }

  async loadCumulativeMetrics(accountId: string, start: Date, end: Date) {
    const snapshots = await this.db.metricSnapshot.findMany({
      where: { note: { accountId }, capturedAt: { gte: start, lte: end }, availability: 'available', value: { not: null } },
      select: { metricDefinitionId: true, noteId: true, capturedAt: true, value: true },
      orderBy: { capturedAt: 'asc' },
    });
    return snapshots.map((snapshot) => ({ ...snapshot, value: Number(snapshot.value) }));
  }

  async createVersion(input: CreateReportVersionInput) {
    return this.db.$transaction(async (tx) => {
      const scope = `${input.accountId}:${input.type}:${input.periodStart.toISOString()}:${input.periodEnd.toISOString()}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}))`;
      const latest = await tx.report.findFirst({
        where: { accountId: input.accountId, reportType: input.type, periodStart: input.periodStart, periodEnd: input.periodEnd },
        orderBy: { version: 'desc' }, select: { version: true },
      });
      return tx.report.create({
        data: {
          accountId: input.accountId, reportType: input.type, periodStart: input.periodStart, periodEnd: input.periodEnd,
          version: (latest?.version ?? 0) + 1, status: input.status, missingDates: input.missingDates,
          metrics: { create: input.metrics.map((metric) => ({
            metricDefinitionId: metric.metricDefinitionId, availability: 'available', value: metric.value,
          })) },
        },
        select: { accountId: true, version: true, status: true },
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
    value: [...notes.values()].reduce((total, values) => total + aggregateCumulative(
      values.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime()).map((item) => item.value),
    ), 0),
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
