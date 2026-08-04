import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';

import type { DatabaseClient } from '@xhs/database';
import { parseSelfScrapeJsonl, type NormalizedSelfScrapeRecord } from '@xhs/self-scrape-import';

export interface SelfScrapeImportOptions {
  file: string;
  accountPlatformId: string;
  commit: boolean;
  db: DatabaseClient;
}

export interface SelfScrapeImportSummary {
  runId: string | null;
  sha256: string;
  totalBytes: number;
  validLines: number;
  invalidLines: number;
  notesChanged: number;
  snapshotsChanged: number;
}

const definitions = [
  ['views', '阅读量'], ['likes', '点赞'], ['comments', '评论'],
] as const;

export async function importSelfScrapeFile(options: SelfScrapeImportOptions): Promise<SelfScrapeImportSummary> {
  const runId = options.commit ? `self-scrape-import-${randomUUID()}` : null;
  let notesChanged = 0;
  let snapshotsChanged = 0;
  const validation = parseSelfScrapeJsonl(createReadStream(options.file));
  for await (const _entry of validation.entries) { /* validate and summarize before any write */ }
  const dryRun = await validation.summary;
  if (!options.commit) return { ...dryRun, runId, notesChanged, snapshotsChanged };

  const accountTargetHash = createHash('sha256').update(options.accountPlatformId).digest('hex');
  await options.db.auditLog.create({ data: { actor: 'local-cli', action: 'self_scrape.import_started', entityType: 'SelfScrapeImportRun', entityId: runId!, details: { accountTargetHash, sha256: dryRun.sha256, totalBytes: dryRun.totalBytes, totalLines: dryRun.totalLines, validLines: dryRun.validLines, invalidLines: dryRun.invalidLines } } });
  const parsed = parseSelfScrapeJsonl(createReadStream(options.file));
  try {
    for await (const entry of parsed.entries) {
      if (!entry.ok) continue;
      const result = await commitRecord(options.db, options.accountPlatformId, entry.record, runId!);
      notesChanged += result.noteChanged ? 1 : 0;
      snapshotsChanged += result.snapshotsChanged;
    }

    const committedFile = await parsed.summary;
    if (committedFile.sha256 !== dryRun.sha256) throw new Error('input file changed after validation');
    const account = await options.db.account.upsert({
      where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: options.accountPlatformId } },
      create: { connectorType: 'self-scrape', platformId: options.accountPlatformId }, update: {},
    });
    const details = { source: 'self-scrape', sha256: dryRun.sha256, totalBytes: dryRun.totalBytes, totalLines: dryRun.totalLines, validLines: dryRun.validLines, invalidLines: dryRun.invalidLines, notesChanged, snapshotsChanged };
    await options.db.$transaction(async (tx) => {
      await tx.syncJob.create({ data: { externalJobId: runId!, accountId: account.id, status: 'succeeded', currentStage: 'complete', startedAt: new Date(), completedAt: new Date(), payload: details } });
      await tx.auditLog.create({ data: { actor: 'local-cli', action: 'self_scrape.import_succeeded', entityType: 'SelfScrapeImportRun', entityId: runId!, details } });
    });
    return { ...dryRun, runId, notesChanged, snapshotsChanged };
  } catch (error) {
    await options.db.auditLog.create({ data: { actor: 'local-cli', action: 'self_scrape.import_failed', entityType: 'SelfScrapeImportRun', entityId: runId!, details: { code: error instanceof Error ? error.name : 'UnknownError', sha256: dryRun.sha256, totalBytes: dryRun.totalBytes, totalLines: dryRun.totalLines, validLines: dryRun.validLines, invalidLines: dryRun.invalidLines, notesChanged, snapshotsChanged } } }).catch(() => undefined);
    throw error;
  }
}

async function commitRecord(db: DatabaseClient, accountPlatformId: string, record: NormalizedSelfScrapeRecord, runId: string) {
  return db.$transaction(async (tx) => {
    const account = await tx.account.upsert({
      where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: accountPlatformId } },
      create: { connectorType: 'self-scrape', platformId: accountPlatformId },
      update: {},
    });
    const existingNote = await tx.note.findUnique({ where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: record.note.platformId } } });
    if (existingNote && existingNote.accountId !== account.id) throw new Error('self-scrape note belongs to a different account');
    const noteChanged = !existingNote || existingNote.title !== record.note.title || existingNote.publishedAt.toISOString() !== record.note.publishedAt;
    const note = existingNote
      ? noteChanged
        ? await tx.note.update({ where: { id: existingNote.id }, data: { title: record.note.title, publishedAt: new Date(record.note.publishedAt), lastSeenAt: new Date() } })
        : existingNote
      : await tx.note.create({ data: { accountId: account.id, connectorType: 'self-scrape', platformId: record.note.platformId, title: record.note.title, publishedAt: new Date(record.note.publishedAt) } });
    let snapshotsChanged = 0;
    const changedRevisions: string[] = [];
    for (const [key, displayName] of definitions) {
      const metric = record.metrics.find((candidate) => candidate.key === key)!;
      const definition = await tx.metricDefinition.upsert({
        where: { key_source_version: { key, source: 'self-scrape', version: 'jsonl-v1' } },
        create: { key, displayName, unit: 'count', aggregation: 'cumulative_delta', source: 'self-scrape', version: 'jsonl-v1', effectiveFrom: new Date(0) },
        update: {},
      });
      const capturedAt = new Date(metric.capturedAt);
      const existing = await tx.metricSnapshot.findFirst({ where: { noteId: note.id, metricDefinitionId: definition.id, capturedAt, supersededAt: null } });
      const exact = existing && existing.availability === metric.availability && existing.value?.toString() === (metric.value === null ? undefined : String(metric.value));
      if (exact) continue;
      if (existing) {
        const correctedAt = new Date();
        await tx.$executeRaw`SELECT supersede_metric_snapshot(${existing.id}::uuid, ${correctedAt}::timestamptz)`;
        await tx.metricSnapshot.create({ data: { noteId: note.id, metricDefinitionId: definition.id, availability: metric.availability, value: metric.value, capturedAt, observedAt: capturedAt, source: 'self-scrape', aggregation: 'cumulative_delta', aggregationVersion: 'jsonl-v1', authoritativePeriod: false, revision: existing.revision + 1, supersedesId: existing.id, correctedAt, correctionReason: 'changed_self_scrape_observation', sourceRunId: runId } });
        changedRevisions.push(`${key}:${existing.revision + 1}`);
      } else {
        await tx.metricSnapshot.create({ data: { noteId: note.id, metricDefinitionId: definition.id, availability: metric.availability, value: metric.value, capturedAt, observedAt: capturedAt, source: 'self-scrape', aggregation: 'cumulative_delta', aggregationVersion: 'jsonl-v1', authoritativePeriod: false, sourceRunId: runId } });
        changedRevisions.push(`${key}:1`);
      }
      snapshotsChanged += 1;
    }
    if (snapshotsChanged > 0) {
      const date = shanghaiDate(record.metrics[0]!.capturedAt);
      const id = createHash('sha256').update(`${note.id}\0${record.metrics[0]!.capturedAt}\0${changedRevisions.join(',')}`).digest('hex').slice(0, 32);
      await tx.backfillEvent.upsert({ where: { id }, create: { id, accountId: account.id, noteId: note.id, capturedDates: [date], reason: 'self_scrape_observation_committed', source: 'self-scrape', businessDate: date }, update: {} });
    }
    return { noteChanged, snapshotsChanged };
  });
}

function shanghaiDate(timestamp: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}
