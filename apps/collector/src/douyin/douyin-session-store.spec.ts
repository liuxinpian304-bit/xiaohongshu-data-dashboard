import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DouyinSessionStore } from './douyin-session-store';

const roots: string[] = [];
const identity = { platformId: 'douyin:7390000000000000000', douyinAccountId: 'tonic123', displayName: 'Tonic', avatarUrl: null };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function store() {
  const root = await mkdtemp(join(tmpdir(), 'douyin-store-'));
  roots.push(root);
  return { root, store: new DouyinSessionStore(root) };
}

describe('DouyinSessionStore', () => {
  it('creates an isolated 0700 profile and persists only verified identity in a 0600 map', async () => {
    const { root, store: sessions } = await store();
    const record = await sessions.create();
    expect((await stat(record.profileDirectory)).mode & 0o777).toBe(0o700);

    const bound = await sessions.bindIdentity(record.sessionId, identity, '2026-08-11T06:00:00.000Z');
    expect(bound).toMatchObject({ platformId: identity.platformId, identityVerifiedAt: '2026-08-11T06:00:00.000Z' });
    expect((await stat(join(root, 'sessions.json'))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(join(root, 'sessions.json'), 'utf8'))).toEqual({
      version: 1,
      sessions: [{ sessionId: record.sessionId, platformId: identity.platformId, identityVerifiedAt: '2026-08-11T06:00:00.000Z' }],
    });
  });

  it.each(['../escape', '/absolute', 'a/b', ''])('rejects invalid session id %j', async (sessionId) => {
    const { store: sessions } = await store();
    await expect(sessions.open(sessionId)).rejects.toThrow('invalid_douyin_session_id');
  });

  it('restores profile paths from the bounded identity map', async () => {
    const { root, store: sessions } = await store();
    const created = await sessions.create();
    await sessions.bindIdentity(created.sessionId, identity, '2026-08-11T06:00:00.000Z');

    const restored = await new DouyinSessionStore(root).list();
    expect(restored).toEqual([{ ...created, platformId: identity.platformId, identityVerifiedAt: '2026-08-11T06:00:00.000Z' }]);
  });
});
