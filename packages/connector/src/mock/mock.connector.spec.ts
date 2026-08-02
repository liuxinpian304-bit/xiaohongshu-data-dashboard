import { describe, expect, it } from 'vitest';

import { MockXhsConnector } from '../index';

describe('MockXhsConnector', () => {
  it('returns every mock comment across cursors without duplicate ids', async () => {
    const connector = new MockXhsConnector();
    const ids: string[] = [];
    let cursor: string | null = null;

    do {
      const page = await connector.listComments({ noteId: 'note-1', cursor });
      ids.push(...page.items.map((item) => item.platformId));
      cursor = page.nextCursor;

      if (!cursor) {
        expect(page.hasMore).toBe(false);
        expect(page.nextCursor).toBeNull();
      }
    } while (cursor);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(12);
  });

  it('provides four deterministic notes and thirty daily metrics for each mock account', async () => {
    const connector = new MockXhsConnector();

    for (const accountId of ['account-1', 'account-2', 'account-3']) {
      const notes = await collectPages((cursor) =>
        connector.listNotes({ accountId, cursor, limit: 3 }),
      );

      expect(notes).toHaveLength(4);
      expect(notes.every((note) => note.accountId === accountId)).toBe(true);
      expect(notes.every((note) => note.source === 'mock')).toBe(true);

      for (const note of notes) {
        const metrics = await connector.getNoteMetrics({ noteId: note.platformId });
        expect(metrics).toHaveLength(30);
        expect(new Set(metrics.map((metric) => metric.capturedAt)).size).toBe(30);
        expect(metrics.every((metric) => metric.source === 'mock')).toBe(true);
      }
    }
  });

  it('provides mock replies for some comments through the same page contract', async () => {
    const connector = new MockXhsConnector();
    const replies = await collectPages((cursor) =>
      connector.listReplies({ commentId: 'comment-note-1-1', cursor, limit: 1 }),
    );

    expect(replies).toHaveLength(2);
    expect(replies.every((reply) => reply.parentCommentId === 'comment-note-1-1')).toBe(true);
    expect(replies.every((reply) => reply.source === 'mock')).toBe(true);
  });

  it.each(['not-base64!', 'LTE=', 'OTk=', 'MS41'])('rejects invalid cursor %s', async (cursor) => {
    const connector = new MockXhsConnector();

    await expect(connector.listComments({ noteId: 'note-1', cursor })).rejects.toThrow(
      'Invalid cursor',
    );
  });

  it('returns mock authorization, capability, and refreshed credential outputs', async () => {
    const connector = new MockXhsConnector();
    const capabilities = await connector.getCapabilities();
    const request = await connector.beginAuthorization({ redirectUri: 'https://app.test/callback' });
    const credential = await connector.completeAuthorization({ code: 'code', state: request.state });
    const refreshed = await connector.refreshCredential({ refreshToken: credential.refreshToken });

    expect(capabilities).toMatchObject({ source: 'mock', notes: true, comments: true });
    expect(request).toMatchObject({ source: 'mock' });
    expect(credential).toMatchObject({ source: 'mock' });
    expect(refreshed).toMatchObject({ source: 'mock' });
  });

  it('returns an explicitly non-navigable mock authorization sentinel', async () => {
    const connector = new MockXhsConnector();

    const request = await connector.beginAuthorization({ redirectUri: 'https://app.test/callback' });

    expect(request.authorizationUrl).toBe('mock:authorization');
  });

  it.each([
    { code: 'code', state: 'wrong-state' },
    { code: '', state: 'mock-authorization-state' },
  ])('rejects an invalid mock authorization response: $code/$state', async (input) => {
    const connector = new MockXhsConnector();

    await expect(connector.completeAuthorization(input)).rejects.toThrow(
      'Invalid mock authorization response',
    );
  });
});

async function collectPages<T>(
  getPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null; hasMore: boolean }>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;

  do {
    const page = await getPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
    expect(page.hasMore).toBe(cursor !== null);
  } while (cursor);

  return items;
}
