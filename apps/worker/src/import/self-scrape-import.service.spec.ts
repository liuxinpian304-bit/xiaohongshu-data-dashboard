import { mkdtemp, writeFile } from 'node:fs/promises';
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
    await prisma.account.deleteMany({ where: { connectorType: 'self-scrape' } });
  });

  afterAll(async () => prisma.$disconnect());

  it('commits one note and three source-isolated metric snapshots', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xhs-self-import-'));
    const file = join(directory, 'my_notes.jsonl');
    await writeFile(file, `${JSON.stringify(record)}\n`);

    const summary = await importSelfScrapeFile({ file, accountPlatformId: 'my-own-account', commit: true, db: prisma });

    expect(summary).toMatchObject({ validLines: 1, invalidLines: 0, notesChanged: 1, snapshotsChanged: 3 });
    const account = await prisma.account.findUniqueOrThrow({ where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: 'my-own-account' } } });
    expect(await prisma.note.count({ where: { accountId: account.id, connectorType: 'self-scrape' } })).toBe(1);
    expect(await prisma.metricDefinition.count({ where: { source: 'self-scrape', version: 'jsonl-v1' } })).toBe(3);
    expect(await prisma.metricSnapshot.count({ where: { source: 'self-scrape', authoritativePeriod: false } })).toBe(3);
    expect(await prisma.metricSnapshot.findFirstOrThrow({ where: { source: 'self-scrape', metricDefinition: { key: 'views' } } })).toMatchObject({ availability: 'not_provided', value: null });
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
  });
});
