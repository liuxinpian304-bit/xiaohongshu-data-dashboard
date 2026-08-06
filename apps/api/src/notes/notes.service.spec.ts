import { describe, expect, it } from 'vitest';
import { projectNoteMetrics } from './notes.service';

describe('projectNoteMetrics', () => {
  it('keeps the latest effective snapshot per metric and preserves unknown values', () => {
    const snapshots = [
      snapshot('likes', '点赞', '12', 'available', '2026-08-05T00:00:00.000Z'),
      snapshot('likes', '点赞', '9', 'available', '2026-08-04T00:00:00.000Z'),
      snapshot('comments', '评论', null, 'not_provided', '2026-08-05T00:00:00.000Z'),
    ];

    expect(projectNoteMetrics(snapshots)).toEqual([
      expect.objectContaining({ key: 'likes', value: '12', availability: 'available' }),
      expect.objectContaining({ key: 'comments', value: null, availability: 'not_provided' }),
    ]);
  });
});

function snapshot(key: string, displayName: string, value: string | null, availability: string, capturedAt: string) {
  return {
    value: value === null ? null : { toString: () => value }, availability, source: 'self-scrape',
    observedAt: new Date(capturedAt), capturedAt: new Date(capturedAt), revision: 1, supersededAt: null,
    metricDefinition: { key, displayName, version: 'v1', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null },
  };
}
