import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { normalizeSelfScrapeRecord, parseSelfScrapeJsonl } from './index';

const sample = {
  note: {
    platformId: '66d3b9a0000000001a030000',
    accountId: '',
    title: '我的笔记标题',
    publishedAt: '2026-07-01T12:00:00+00:00',
    source: 'self-scrape',
  },
  metrics: {
    noteId: '66d3b9a0000000001a030000',
    capturedAt: '2026-08-03T05:30:00+00:00',
    views: 0,
    likes: 1200,
    comments: 86,
    source: 'self-scrape',
  },
  extra: { collected: 430, shares: 12 },
  views_available: false,
};

describe('normalizeSelfScrapeRecord', () => {
  it('normalizes a self-scrape sample without inventing an authoritative window', () => {
    expect(normalizeSelfScrapeRecord(sample)).toEqual({
      note: {
        connectorType: 'self-scrape',
        platformId: '66d3b9a0000000001a030000',
        inputAccountId: '',
        title: '我的笔记标题',
        publishedAt: '2026-07-01T12:00:00.000Z',
      },
      metrics: [
        { key: 'views', availability: 'not_provided', value: null, capturedAt: '2026-08-03T05:30:00.000Z', source: 'self-scrape', aggregation: 'cumulative_delta', aggregationVersion: 'jsonl-v1', authoritativePeriod: false, windowStart: null, windowEnd: null },
        { key: 'likes', availability: 'available', value: 1200, capturedAt: '2026-08-03T05:30:00.000Z', source: 'self-scrape', aggregation: 'cumulative_delta', aggregationVersion: 'jsonl-v1', authoritativePeriod: false, windowStart: null, windowEnd: null },
        { key: 'comments', availability: 'available', value: 86, capturedAt: '2026-08-03T05:30:00.000Z', source: 'self-scrape', aggregation: 'cumulative_delta', aggregationVersion: 'jsonl-v1', authoritativePeriod: false, windowStart: null, windowEnd: null },
      ],
      extra: { collected: 430, shares: 12 },
    });
  });

  it('maps available zero values to zero availability', () => {
    const normalized = normalizeSelfScrapeRecord({
      ...sample,
      metrics: { ...sample.metrics, views: 0, likes: 0, comments: 0 },
      views_available: true,
    });
    expect(normalized.metrics.map(({ availability, value }) => ({ availability, value }))).toEqual([
      { availability: 'zero', value: 0 },
      { availability: 'zero', value: 0 },
      { availability: 'zero', value: 0 },
    ]);
  });

  it.each([
    ['note id mismatch', { ...sample, metrics: { ...sample.metrics, noteId: 'different' } }],
    ['wrong note source', { ...sample, note: { ...sample.note, source: 'mock' } }],
    ['wrong metric source', { ...sample, metrics: { ...sample.metrics, source: 'official' } }],
    ['timezone-less timestamp', { ...sample, metrics: { ...sample.metrics, capturedAt: '2026-08-03T05:30:00' } }],
    ['invalid calendar timestamp', { ...sample, note: { ...sample.note, publishedAt: '2026-02-30T00:00:00Z' } }],
    ['negative metric', { ...sample, metrics: { ...sample.metrics, likes: -1 } }],
    ['unsafe metric integer', { ...sample, metrics: { ...sample.metrics, comments: Number.MAX_SAFE_INTEGER + 1 } }],
    ['unknown root field', { ...sample, unexpected: true }],
    ['unknown nested field', { ...sample, note: { ...sample.note, url: 'https://example.test' } }],
  ])('rejects %s', (_name, input) => {
    expect(() => normalizeSelfScrapeRecord(input)).toThrow();
  });

  it('does not accept required fields inherited from a prototype', () => {
    const inheritedNote = Object.create(sample.note) as typeof sample.note;
    expect(() => normalizeSelfScrapeRecord({ ...sample, note: inheritedNote })).toThrow();
  });

  it('does not expose unknown input keys in validation errors', () => {
    const sensitiveKey = 'private-session-token-value';
    expect(() => normalizeSelfScrapeRecord({ ...sample, [sensitiveKey]: true })).toThrowError(expect.not.stringContaining(sensitiveKey));
  });

  it('uses JSON Schema compatible Unicode code-point length limits', () => {
    expect(() => normalizeSelfScrapeRecord({ ...sample, note: { ...sample.note, title: '😀'.repeat(1_000) } })).not.toThrow();
  });
});

describe('parseSelfScrapeJsonl', () => {
  it('streams valid and invalid lines and returns a redacted dry-run summary', async () => {
    const jsonl = `${JSON.stringify(sample)}\nnot-json\n`;
    const parsed = parseSelfScrapeJsonl(Readable.from([jsonl]), { maxLineBytes: 4096, maxFileBytes: 8192, maxLines: 10 });
    const entries = [];
    for await (const entry of parsed.entries) entries.push(entry);

    expect(entries).toEqual([
      expect.objectContaining({ lineNumber: 1, ok: true, record: expect.objectContaining({ note: expect.objectContaining({ platformId: sample.note.platformId }) }) }),
      { lineNumber: 2, ok: false, error: { code: 'invalid_json', message: 'line is not valid JSON' } },
    ]);
    expect(await parsed.summary).toEqual({
      sha256: '291c2dc40d581915f9b8167f338f9ea127d1a40c0fb37523ba3f9b3e413fe3e0',
      totalBytes: Buffer.byteLength(jsonl),
      totalLines: 2,
      validLines: 1,
      invalidLines: 1,
      availability: { available: 2, zero: 0, not_provided: 1 },
    });
    expect(JSON.stringify(await parsed.summary)).not.toContain(sample.note.title);
  });

  it.each([
    ['line byte limit', `${JSON.stringify(sample)}\n`, { maxLineBytes: 20, maxFileBytes: 8192, maxLines: 10 }, 'line_too_large'],
    ['file byte limit', `${JSON.stringify(sample)}\n`, { maxLineBytes: 4096, maxFileBytes: 20, maxLines: 10 }, 'file_too_large'],
    ['line count limit', `${JSON.stringify(sample)}\n${JSON.stringify(sample)}\n`, { maxLineBytes: 4096, maxFileBytes: 16384, maxLines: 1 }, 'too_many_lines'],
  ])('enforces the %s', async (_name, jsonl, limits, code) => {
    const parsed = parseSelfScrapeJsonl(Readable.from([jsonl]), limits);
    await expect(async () => {
      for await (const _entry of parsed.entries) { /* consume */ }
    }).rejects.toMatchObject({ code });
    await expect(parsed.summary).rejects.toMatchObject({ code });
  });

  it('parses a line fragmented into many small chunks', async () => {
    const jsonl = `${JSON.stringify(sample)}\n`;
    const parsed = parseSelfScrapeJsonl(Readable.from([...Buffer.from(jsonl)].map((byte) => Buffer.from([byte]))), { maxLineBytes: 4096 });
    const entries = [];
    for await (const entry of parsed.entries) entries.push(entry);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ ok: true, lineNumber: 1 });
    expect((await parsed.summary).totalBytes).toBe(Buffer.byteLength(jsonl));
  });

  it('rejects the summary when a caller cancels entry consumption', async () => {
    const jsonl = `${JSON.stringify(sample)}\n${JSON.stringify(sample)}\n`;
    const parsed = parseSelfScrapeJsonl(Readable.from([jsonl]));
    const iterator = parsed.entries[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ ok: true, lineNumber: 1 });
    await iterator.return?.(undefined);
    await expect(parsed.summary).rejects.toMatchObject({ code: 'parse_cancelled' });
  });

  it('rejects summary access before entry consumption starts instead of hanging', async () => {
    const parsed = parseSelfScrapeJsonl(Readable.from([`${JSON.stringify(sample)}\n`]));
    await expect(parsed.summary).rejects.toMatchObject({ code: 'parse_not_started' });
  });

  it('rejects invalid UTF-8 instead of importing replacement characters', async () => {
    const prefix = Buffer.from('{"note":{"platformId":"');
    const suffix = Buffer.from('"}}\n');
    const parsed = parseSelfScrapeJsonl(Readable.from([Buffer.concat([prefix, Buffer.from([0xff]), suffix])]));
    const entries = [];
    for await (const entry of parsed.entries) entries.push(entry);
    expect(entries).toEqual([
      { lineNumber: 1, ok: false, error: { code: 'invalid_json', message: 'line is not valid UTF-8 JSON' } },
    ]);
    expect(await parsed.summary).toMatchObject({ totalLines: 1, validLines: 0, invalidLines: 1 });
  });
});
