import { describe, expect, it } from 'vitest';

import { parseSelfScrapeImportArgs } from './self-scrape-import.cli';

describe('parseSelfScrapeImportArgs', () => {
  it('defaults to dry-run and requires explicit commit', () => {
    expect(parseSelfScrapeImportArgs(['--file', '/tmp/my_notes.jsonl', '--account', 'my-account'])).toEqual({
      file: '/tmp/my_notes.jsonl', accountPlatformId: 'my-account', commit: false,
    });
    expect(parseSelfScrapeImportArgs(['--file', '/tmp/my_notes.jsonl', '--account', 'my-account', '--commit'])).toMatchObject({ commit: true });
  });

  it.each([
    [[]],
    [['--file', '/tmp/my_notes.jsonl']],
    [['--account', 'my-account']],
    [['--file', '/tmp/my_notes.jsonl', '--account', 'my-account', '--unknown']],
  ])('rejects incomplete or unsupported arguments: %j', (args) => {
    expect(() => parseSelfScrapeImportArgs(args)).toThrow();
  });
});
