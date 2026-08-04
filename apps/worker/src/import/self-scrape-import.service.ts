import { createHash } from 'node:crypto';
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
  sha256: string;
  totalBytes: number;
  validLines: number;
  invalidLines: number;
  notesChanged: number;
  snapshotsChanged: number;
}

const definitions = [
  ['views', '浏览量'], ['likes', '点赞量'], ['comments', '评论量'],
] as const;

export async function importSelfScrapeFile(options: SelfScrapeImportOptions): Promise<SelfScrapeImportSummary> {
  const parsed = parseSelfScrapeJsonl(createReadStream(options.file));
  let notesChanged = 0;
  let snapshotsChanged = 0;

  for await (const entry of parsed.entries) {
    if (!entry.ok || !options.commit) continue;
    const result = await commitRecord(options.db, options.accountPlatformId, entry.record);
    notesChanged += result.noteChanged ? 1 : 0;
    snapshotsChanged += result.snapshotsChanged;
  }

  const dryRun = await parsed.summary;
  return { ...dryRun, notesChanged, snapshotsChanged };
}

async function commitRecord(db: DatabaseClient, accountPlatformId: string, record: NormalizedSelfScrapeRecord) {
  return db.$transaction(async (tx) => {
    const account = await tx.account.upsert({
      where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: accountPlatformId } },
      create: { connectorType: 'self-scrape', platformId: accountPlatformId },
      update: {},
    });
    const existingNote = await tx.note.findUnique({ where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: record.note.platformId } } });
    if (existingNote && existingNote.accountId !== account.id) throw new Error('self-scrape note belongs to a different account');
    const note = await tx.note.upsert({
      where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: record.note.platformId } },
      create: { accountId: account.id, connectorType: 'self-scrape', platformId: record.note.platformId, title: record.note.title, publishedAt: new Date(record.note.publishedAt) },
      update: { title: record.note.title, publishedAt: new Date(record.note.publishedAt), lastSeenAt: new Date() },
    });
    let snapshotsChanged = 0;
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
        await tx.metricSnapshot.create({ data: { noteId: note.id, metricDefinitionId: definition.id, availability: metric.availability, value: metric.value, capturedAt, observedAt: capturedAt, source: 'self-scrape', aggregation: 'cumulative_delta', aggregationVersion: 'jsonl-v1', authoritativePeriod: false, revision: existing.revision + 1, supersedesId: existing.id, correctedAt, correctionReason: 'changed_self_scrape_observation' } });
      } else {
        await tx.metricSnapshot.create({ data: { noteId: note.id, metricDefinitionId: definition.id, availability: metric.availability, value: metric.value, capturedAt, observedAt: capturedAt, source: 'self-scrape', aggregation: 'cumulative_delta', aggregationVersion: 'jsonl-v1', authoritativePeriod: false } });
      }
      snapshotsChanged += 1;
    }
    if (snapshotsChanged > 0) {
      const date = shanghaiDate(record.metrics[0]!.capturedAt);
      const id = createHash('sha256').update(`${note.id}\0${record.metrics[0]!.capturedAt}\0${record.metrics.map(({ value, availability }) => `${availability}:${value}`).join(',')}`).digest('hex').slice(0, 32);
      await tx.backfillEvent.upsert({ where: { id }, create: { id, accountId: account.id, noteId: note.id, capturedDates: [date], reason: 'self_scrape_observation_committed', source: 'self-scrape', businessDate: date }, update: {} });
    }
    return { noteChanged: !existingNote || existingNote.title !== record.note.title || existingNote.publishedAt.toISOString() !== record.note.publishedAt, snapshotsChanged };
  });
}

function shanghaiDate(timestamp: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}
