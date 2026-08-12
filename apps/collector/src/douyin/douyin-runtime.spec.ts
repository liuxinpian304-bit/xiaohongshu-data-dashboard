import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRuntimeDouyinRegistry, safeLaunchError, safePayloadShape } from './douyin-runtime';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('runtime Douyin registry', () => {
  it('reports only an official URL path and bounded JSON keys for diagnostics', () => {
    expect(safePayloadShape('https://creator.douyin.com/aweme/v1/list?token=secret', { aweme_list: [{ item: { aweme_id: 'secret' }, status: 1 }], items: [], cursor: 1 })).toEqual({ path: '/aweme/v1/list', keys: ['aweme_list', 'cursor', 'items'], dataKeys: [], arrayCounts: { aweme_list: 1, items: 0 }, listItemKeys: ['item', 'status'], listItemObjectKeys: { item: ['aweme_id'] } });
    expect(safePayloadShape('https://evil.test/steal?token=secret', { token: 'secret' })).toBeNull();
  });

  it('classifies Chrome launch failures without exposing paths or secrets', () => {
    expect(safeLaunchError(new Error('browserType.launchPersistentContext: Failed to launch chrome because profile /secret/path is in use'))).toEqual({ name: 'Error', code: 'profile_in_use' });
    expect(safeLaunchError(new Error('token=secret unknown failure'))).toEqual({ name: 'Error', code: 'unknown' });
  });

  it('launches an isolated official creator page and verifies identity from an official response', async () => {
    const root = await mkdtemp(join(tmpdir(), 'douyin-runtime-')); roots.push(root);
    let responseHandler: ((response: any) => Promise<void>) | undefined;
    const page = {
      url: () => 'https://creator.douyin.com/creator-micro/home',
      locator: (selector: string) => ({ first: () => ({ isVisible: async () => selector === '[data-e2e="user-avatar"]', screenshot: async () => Buffer.alloc(0) }) }),
      on: (_event: string, handler: (response: any) => Promise<void>) => { responseHandler = handler; },
      goto: vi.fn(async () => { await responseHandler?.({ url: () => 'https://creator.douyin.com/web/api/media/user/info', headers: () => ({ 'content-type': 'application/json', 'content-length': '128' }), json: async () => ({ data: { uid: '7390000000000000000', unique_id: 'tonic123', nickname: 'Tonic' } }) }); }),
    };
    const close = vi.fn(async () => undefined);
    const registry = createRuntimeDouyinRegistry(root, async () => ({ pages: () => [page], newPage: async () => page, close } as any));

    await expect(registry.createSession()).resolves.toMatchObject({ state: 'authenticated', identity: { platformId: 'douyin:7390000000000000000', displayName: 'Tonic' } });
    expect(page.goto).toHaveBeenCalledWith('https://creator.douyin.com/creator-micro/home', expect.objectContaining({ waitUntil: 'domcontentloaded' }));
  });
});
