import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DouyinRegistry } from './douyin-registry';
import { DouyinSessionStore } from './douyin-session-store';

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('DouyinRegistry', () => {
  it('creates and lists isolated sessions without exposing profile paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'douyin-registry-')); roots.push(root);
    const registry = new DouyinRegistry(new DouyinSessionStore(root), () => ({
      start: async () => ({ state: 'awaiting_scan' as const, changedAt: '2026-08-11T06:00:00.000Z' }),
      status: () => ({ state: 'awaiting_scan' as const, changedAt: '2026-08-11T06:00:00.000Z' }),
      refresh: async () => ({ state: 'awaiting_scan' as const, changedAt: '2026-08-11T06:00:00.000Z' }),
      qr: () => ({ bytes: Buffer.from('png'), contentType: 'image/png' as const, expiresAt: '2026-08-11T06:02:00.000Z' }),
      close: async () => ({ state: 'closed' as const, changedAt: '2026-08-11T06:03:00.000Z' }),
    }));

    const created = await registry.createSession();
    expect(created).toMatchObject({ sessionId: expect.any(String), state: 'awaiting_scan' });
    expect(created).not.toHaveProperty('profileDirectory');
    expect(await registry.listSessions()).toEqual([created]);
  });

  it('rejects unknown session ids before manager access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'douyin-registry-')); roots.push(root);
    const registry = new DouyinRegistry(new DouyinSessionStore(root), () => { throw new Error('factory_should_not_run'); });
    await expect(registry.status('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).rejects.toThrow('douyin_session_not_found');
  });
});
