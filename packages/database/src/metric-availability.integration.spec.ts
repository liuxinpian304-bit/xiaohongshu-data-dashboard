import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from './client';

describe('metric availability persistence', () => {
  beforeEach(async () => {
    await prisma.reportMetric.deleteMany();
    await prisma.report.deleteMany();
    await prisma.metricSnapshot.deleteMany();
    await prisma.metricDefinition.deleteMany();
    await prisma.note.deleteMany();
    await prisma.account.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createMetricContext() {
    const account = await prisma.account.create({
      data: {
        connectorType: 'xiaohongshu',
        platformId: 'account-availability',
      },
    });
    const note = await prisma.note.create({
      data: {
        accountId: account.id,
        connectorType: 'xiaohongshu',
        platformId: 'note-availability',
        title: 'Availability fixture',
        publishedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    });
    const definition = await prisma.metricDefinition.create({
      data: { key: 'views', displayName: 'Views', unit: 'count' },
    });
    return { account, note, definition };
  }

  it('stores a zero metric whose measured value is zero', async () => {
    const { note, definition } = await createMetricContext();

    const snapshot = await prisma.metricSnapshot.create({
      data: {
        noteId: note.id,
        metricDefinitionId: definition.id,
        availability: 'zero',
        value: 0,
        capturedAt: new Date('2026-08-02T00:00:00.000Z'),
        source: 'official_api',
      },
    });

    expect(snapshot.availability).toBe('zero');
    expect(snapshot.value?.toString()).toBe('0');
  });

  it('stores a not-provided metric without a value', async () => {
    const { note, definition } = await createMetricContext();

    const snapshot = await prisma.metricSnapshot.create({
      data: {
        noteId: note.id,
        metricDefinitionId: definition.id,
        availability: 'not_provided',
        value: null,
        capturedAt: new Date('2026-08-02T00:00:00.000Z'),
        source: 'official_api',
      },
    });

    expect(snapshot.availability).toBe('not_provided');
    expect(snapshot.value).toBeNull();
  });

  it('rejects a metric snapshot value when availability is not-provided', async () => {
    const { note, definition } = await createMetricContext();

    await expect(
      prisma.metricSnapshot.create({
        data: {
          noteId: note.id,
          metricDefinitionId: definition.id,
          availability: 'not_provided',
          value: 1,
          capturedAt: new Date('2026-08-02T00:00:00.000Z'),
          source: 'official_api',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2039' });
  });

  it('rejects a report metric without a value when availability is available', async () => {
    const { account, definition } = await createMetricContext();
    const report = await prisma.report.create({
      data: {
        accountId: account.id,
        reportType: 'weekly',
        periodStart: new Date('2026-07-27T00:00:00.000Z'),
        periodEnd: new Date('2026-08-03T00:00:00.000Z'),
      },
    });

    await expect(
      prisma.reportMetric.create({
        data: {
          reportId: report.id,
          metricDefinitionId: definition.id,
          availability: 'available',
          value: null,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2039' });
  });
});
