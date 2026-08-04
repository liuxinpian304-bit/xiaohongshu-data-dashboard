import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { LocalXhsSessionManager } from './session-manager';

describe('LocalXhsSessionManager', () => {
  it('launches one headed persistent session and returns only redacted state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xhs-profile-test-'));
    const close = vi.fn(async () => undefined);
    const launch = vi.fn(async () => ({ close }));
    const manager = new LocalXhsSessionManager({ profileDirectory: join(root, 'profile'), launch });

    const first = await manager.start();
    const second = await manager.start();

    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ headless: false, url: 'https://www.xiaohongshu.com/' }));
    expect(second).toEqual(first);
    expect(first).toMatchObject({ state: 'browser_open' });
    expect(JSON.stringify(first)).not.toMatch(/cookie|storage|profile/i);
    expect((await stat(join(root, 'profile'))).mode & 0o777).toBe(0o700);
  });

  it('confirms and closes without deleting the persistent profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xhs-profile-test-'));
    const close = vi.fn(async () => undefined);
    const manager = new LocalXhsSessionManager({ profileDirectory: join(root, 'profile'), launch: async () => ({ close }) });
    await manager.start();
    expect(manager.confirm()).toMatchObject({ state: 'user_confirmed' });
    expect(await manager.close()).toMatchObject({ state: 'closed' });
    expect(close).toHaveBeenCalledOnce();
    await expect(stat(join(root, 'profile'))).resolves.toBeDefined();
  });

  it('reports a redacted launch error and permits retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xhs-profile-test-'));
    const launch = vi.fn().mockRejectedValueOnce(new Error('secret browser path')).mockResolvedValueOnce({ close: async () => undefined });
    const manager = new LocalXhsSessionManager({ profileDirectory: join(root, 'profile'), launch });
    await expect(manager.start()).rejects.toThrow('collector_launch_failed');
    expect(manager.status()).toMatchObject({ state: 'error', errorCode: 'collector_launch_failed' });
    expect(JSON.stringify(manager.status())).not.toContain('secret browser path');
    await expect(manager.start()).resolves.toMatchObject({ state: 'browser_open' });
  });
});
