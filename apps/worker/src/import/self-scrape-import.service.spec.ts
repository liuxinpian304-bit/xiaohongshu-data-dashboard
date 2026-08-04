import { mkdtemp, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@xhs/database';

import { importSelfScrapeFile } from './self-scrape-import.service';

const record = {
  note: { platformId: 'self-note-1', accountId: '', title: '真实笔记', publishedAt: '2026-08-01T02:00:00+08:00', source: 'self-scrape' },
  metrics: { noteId: 'self-note-1', capturedAt: '2026-08-03T09:00:00+08:00', views: 0, likes: 12, comments: 3, source: 'self-scrape' },
  views_available: false,
};

describe('importSelfScrapeFile', () => {
  beforeEach(async () => {
    await prisma.backfillEvent.deleteMany({ where: { source: 'self-scrape' } });
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "MetricSnapshot" CASCADE`);
    await prisma.metricDefinition.deleteMany({ where: { source: 'self-scrape' } });
    await prisma.note.deleteMany({ where: { connectorType: 'self-scrape' } });
    await prisma.report.deleteMany({ where: { account: { connectorType: 'self-scrape' } } });
    await prisma.account.deleteMany({ where: { connectorType: 'self-scrape' } });
  });

  afterAll(async () => prisma.$disconnect());

  it('commits one note and three source-isolated metric snapshots', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xhs-self-import-'));
    const file = join(directory, 'my_notes.jsonl');
    await writeFile(file, `${JSON.stringify(record)}\n`);

    const summary = await importSelfScrapeFile({ file, accountPlatformId: 'my-own-account', commit: true, db: prisma });

    expect(summary).toMatchObject({ runId: expect.stringMatching(/^self-scrape-import-/), validLines: 1, invalidLines: 0, notesChanged: 1, snapshotsChanged: 3 });
    const account = await prisma.account.findUniqueOrThrow({ where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: 'my-own-account' } } });
    expect(await prisma.note.count({ where: { accountId: account.id, connectorType: 'self-scrape' } })).toBe(1);
    expect(await prisma.metricDefinition.count({ where: { source: 'self-scrape', version: 'jsonl-v1' } })).toBe(3);
    expect(await prisma.metricSnapshot.count({ where: { source: 'self-scrape', authoritativePeriod: false } })).toBe(3);
    expect(await prisma.metricSnapshot.findFirstOrThrow({ where: { source: 'self-scrape', metricDefinition: { key: 'views' } } })).toMatchObject({ availability: 'not_provided', value: null });
    expect(await prisma.syncJob.findUniqueOrThrow({ where: { externalJobId: summary.runId! } })).toMatchObject({ accountId: account.id, status: 'succeeded', currentStage: 'complete', payload: expect.objectContaining({ source: 'self-scrape', sha256: summary.sha256, validLines: 1, invalidLines: 0 }) });
    expect(await prisma.auditLog.findMany({ where: { entityType: 'SelfScrapeImportRun', entityId: summary.runId! }, orderBy: { createdAt: 'asc' } })).toEqual([
      expect.objectContaining({ action: 'self_scrape.import_started', actor: 'local-cli' }),
      expect.objectContaining({ action: 'self_scrape.import_succeeded', actor: 'local-cli', details: expect.objectContaining({ sha256: summary.sha256, validLines: 1, invalidLines: 0 }) }),
    ]);
  });

  it('replays equal observations as no-ops and appends revisions for changed values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xhs-self-replay-'));
    const file = join(directory, 'my_notes.jsonl');
    await writeFile(file, `${JSON.stringify(record)}\n`);
    await importSelfScrapeFile({ file, accountPlatformId: 'my-own-account', commit: true, db: prisma });
    const noteBeforeReplay = await prisma.note.findUniqueOrThrow({ where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: record.note.platformId } } });

    expect(await importSelfScrapeFile({ file, accountPlatformId: 'my-own-account', commit: true, db: prisma })).toMatchObject({ notesChanged: 0, snapshotsChanged: 0 });
    expect((await prisma.note.findUniqueOrThrow({ where: { id: noteBeforeReplay.id } })).updatedAt).toEqual(noteBeforeReplay.updatedAt);
    await writeFile(file, `${JSON.stringify({ ...record, metrics: { ...record.metrics, likes: 13 } })}\n`);
    expect(await importSelfScrapeFile({ file, accountPlatformId: 'my-own-account', commit: true, db: prisma })).toMatchObject({ snapshotsChanged: 1 });
    await writeFile(file, `${JSON.stringify(record)}\n`);
    expect(await importSelfScrapeFile({ file, accountPlatformId: 'my-own-account', commit: true, db: prisma })).toMatchObject({ snapshotsChanged: 1 });
    expect(await prisma.metricSnapshot.count({ where: { source: 'self-scrape' } })).toBe(5);
    expect(await prisma.metricSnapshot.findFirstOrThrow({ where: { source: 'self-scrape', metricDefinition: { key: 'likes' }, supersededAt: null } })).toMatchObject({ revision: 3 });
    expect(await prisma.backfillEvent.count({ where: { source: 'self-scrape' } })).toBe(3);
  });

  it('performs a dry-run without writing any database rows', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xhs-self-dry-run-'));
    const file = join(directory, 'my_notes.jsonl');
    await writeFile(file, `${JSON.stringify(record)}\n`);

    expect(await importSelfScrapeFile({ file, accountPlatformId: 'dry-account', commit: false, db: prisma })).toMatchObject({ validLines: 1, invalidLines: 0, notesChanged: 0, snapshotsChanged: 0 });
    expect(await prisma.account.count({ where: { connectorType: 'self-scrape' } })).toBe(0);
    expect(await prisma.note.count({ where: { connectorType: 'self-scrape' } })).toBe(0);
    expect(await prisma.metricSnapshot.count({ where: { source: 'self-scrape' } })).toBe(0);
  });

  it('rejects a platform note id already owned by another self-scrape account', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xhs-self-conflict-'));
    const file = join(directory, 'my_notes.jsonl');
    await writeFile(file, `${JSON.stringify(record)}\n`);
    await importSelfScrapeFile({ file, accountPlatformId: 'first-account', commit: true, db: prisma });

    await expect(importSelfScrapeFile({ file, accountPlatformId: 'second-account', commit: true, db: prisma })).rejects.toThrow('different account');
    expect(await prisma.account.count({ where: { connectorType: 'self-scrape' } })).toBe(1);
    const failed = await prisma.auditLog.findFirstOrThrow({ where: { action: 'self_scrape.import_failed' }, orderBy: { createdAt: 'desc' } });
    expect(failed).toMatchObject({ actor: 'local-cli', entityType: 'SelfScrapeImportRun', details: expect.objectContaining({ code: 'Error', sha256: expect.stringMatching(/^[a-f0-9]{64}$/), totalLines: 1, validLines: 1, invalidLines: 0 }) });
    expect(JSON.stringify(failed.details)).not.toContain('second-account');
    expect(JSON.stringify(failed.details)).not.toContain(record.note.title);
  });

  it('audits unreadable commit inputs without leaking the file path', async () => {
    const missingFile = join(tmpdir(), `missing-${randomUUID()}.jsonl`);
    await expect(importSelfScrapeFile({ file: missingFile, accountPlatformId: 'missing-file-account', commit: true, db: prisma })).rejects.toThrow();
    const failed = await prisma.auditLog.findFirstOrThrow({ where: { action: 'self_scrape.import_failed' }, orderBy: { createdAt: 'desc' } });
    expect(await prisma.auditLog.count({ where: { entityId: failed.entityId, action: 'self_scrape.import_started' } })).toBe(1);
    expect(failed.details).toMatchObject({ code: 'Error', sha256: null, totalLines: null });
    expect(JSON.stringify(failed.details)).not.toContain(missingFile);
  });

  it('stops spool copying at the configured byte limit before any database import', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xhs-self-large-'));
    const file = join(directory, 'large.jsonl');
    await writeFile(file, `${JSON.stringify(record)}\n`);
    await expect(importSelfScrapeFile({ file, accountPlatformId: 'large-account', commit: true, db: prisma, limits: { maxFileBytes: 20 } })).rejects.toMatchObject({ code: 'file_too_large' });
    expect(await prisma.account.count({ where: { connectorType: 'self-scrape' } })).toBe(0);
    const failed = await prisma.auditLog.findFirstOrThrow({ where: { action: 'self_scrape.import_failed' }, orderBy: { createdAt: 'desc' } });
    expect(failed.details).toMatchObject({ code: 'SelfScrapeParseError', totalBytes: null });
  });
});
