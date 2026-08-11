import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRuntimeDouyinRegistry } from './douyin-runtime';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('runtime Douyin registry', () => {
  it('launches an isolated official creator page and verifies identity from an official response', async () => {
    const root = await mkdtemp(join(tmpdir(), 'douyin-runtime-')); roots.push(root);
    let responseHandler: ((response: any) => Promise<void>) | undefined;
    const page = {
      url: () => 'https://creator.douyin.com/creator-micro/home',
      locator: (selector: string) => ({ first: () => ({ isVisible: async () => selector === 'text=创作中心', screenshot: async () => Buffer.alloc(0) }) }),
      on: (_event: string, handler: (response: any) => Promise<void>) => { responseHandler = handler; },
      goto: vi.fn(async () => { await responseHandler?.({ url: () => 'https://creator.douyin.com/web/api/media/user/info', headers: () => ({ 'content-type': 'application/json', 'content-length': '128' }), json: async () => ({ data: { uid: '7390000000000000000', unique_id: 'tonic123', nickname: 'Tonic' } }) }); }),
    };
    const close = vi.fn(async () => undefined);
    const registry = createRuntimeDouyinRegistry(root, async () => ({ pages: () => [page], newPage: async () => page, close } as any));

    await expect(registry.createSession()).resolves.toMatchObject({ state: 'authenticated', identity: { platformId: 'douyin:7390000000000000000', displayName: 'Tonic' } });
    expect(page.goto).toHaveBeenCalledWith('https://creator.douyin.com/', expect.objectContaining({ waitUntil: 'domcontentloaded' }));
  });
});
