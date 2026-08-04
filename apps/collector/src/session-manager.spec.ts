import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { LocalXhsSessionManager } from './session-manager';

describe('LocalXhsSessionManager', () => {
  it('binds authenticated status and collection to the same verified account identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xhs-profile-test-'));
    const readAccountIdentity = vi.fn()
      .mockResolvedValueOnce({ platformId: 'user-1', xhsAccountId: 'red-1', displayName: '真实昵称', avatarUrl: null })
      .mockResolvedValueOnce({ platformId: 'user-2', xhsAccountId: 'red-2', displayName: '另一个账号', avatarUrl: null });
    const manager = new LocalXhsSessionManager({
      profileDirectory: join(root, 'profile'),
      launch: async () => ({ close: async () => undefined }),
      adapter: {
        detectLoginState: async () => 'authenticated',
        captureQr: async () => Buffer.from([]),
        readAccountIdentity,
        collectVisibleRecords: async () => ({ notes: [], comments: [] }),
      },
    });

    await expect(manager.start()).resolves.toMatchObject({
      state: 'authenticated',
      identity: { platformId: 'user-1', xhsAccountId: 'red-1', displayName: '真实昵称', avatarUrl: null },
      identityVerifiedAt: expect.any(String),
    });
    await expect(manager.collect(() => undefined, () => undefined, 'run-mismatch')).rejects.toThrow('collector_identity_mismatch');
    expect(JSON.stringify(manager.status())).not.toMatch(/cookie|storage|profile|token/i);
  });

  it('reports authentication only after the creator page proves login', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xhs-profile-test-'));
    const adapter = {
      detectLoginState: vi.fn(async () => 'authenticated' as const),
      captureQr: vi.fn(async () => Buffer.from([])),
      readAccountIdentity: vi.fn(async () => ({ platformId: 'user-authenticated', xhsAccountId: null, displayName: '已登录账号', avatarUrl: null })),
    };
    const manager = new LocalXhsSessionManager({
      profileDirectory: join(root, 'profile'),
      launch: async () => ({ close: async () => undefined }),
      adapter,
    });

    await manager.start();
    const status = await manager.refresh();

    expect(status).toMatchObject({ state: 'authenticated', changedAt: expect.any(String) });
    expect(JSON.stringify(status)).not.toMatch(/cookie|storage|profile|phone/i);
  });

  it('makes a QR snapshot inaccessible after its expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'));
    const root = await mkdtemp(join(tmpdir(), 'xhs-profile-test-'));
    const png = pngFixture(320, 320);
    const manager = new LocalXhsSessionManager({
      profileDirectory: join(root, 'profile'),
      launch: async () => ({ close: async () => undefined }),
      adapter: {
        detectLoginState: async () => 'awaiting_scan',
        captureQr: async () => png,
      },
    });

    await manager.start();
    await manager.refresh();
    expect(manager.qr()).toMatchObject({
      bytes: png,
      contentType: 'image/png',
      expiresAt: '2026-08-04T00:02:00.000Z',
    });
    vi.setSystemTime(new Date('2026-08-04T00:02:01.000Z'));

    expect(() => manager.qr()).toThrow('collector_qr_expired');
    vi.useRealTimers();
  });

  it('rejects a QR image whose declared dimensions exceed the limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xhs-profile-test-'));
    const manager = new LocalXhsSessionManager({
      profileDirectory: join(root, 'profile'),
      launch: async () => ({ close: async () => undefined }),
      adapter: {
        detectLoginState: async () => 'awaiting_scan',
        captureQr: async () => pngFixture(1025, 320),
      },
    });

    await expect(manager.start()).rejects.toThrow('collector_qr_invalid');
  });

  it('launches one headed persistent session and returns only redacted state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xhs-profile-test-'));
    const close = vi.fn(async () => undefined);
    const launch = vi.fn(async () => ({
      close,
      page: {
        url: () => 'https://creator.xiaohongshu.com/login',
        locator: (selector: string) => ({
          first: () => ({
            isVisible: async () => selector === '[class*="qrcode"] canvas',
            screenshot: async () => pngFixture(320, 320),
            click: async () => undefined,
            evaluate: async <TResult,>(fn: (element: { clientWidth: number; clientHeight: number }) => TResult) => fn({ clientWidth: 0, clientHeight: 0 }),
          }),
          all: async () => [],
        }),
      },
    }));
    const manager = new LocalXhsSessionManager({ profileDirectory: join(root, 'profile'), launch });

    const first = await manager.start();
    const second = await manager.start();

    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ headless: false, url: 'https://creator.xiaohongshu.com/' }));
    expect(second).toEqual(first);
    expect(first).toMatchObject({ state: 'awaiting_scan', qrExpiresAt: expect.any(String) });
    expect(JSON.stringify(first)).not.toMatch(/cookie|storage|profile/i);
    expect((await stat(join(root, 'profile'))).mode & 0o777).toBe(0o700);
  });

  it('closes without deleting the persistent profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xhs-profile-test-'));
    const close = vi.fn(async () => undefined);
    const manager = new LocalXhsSessionManager({ profileDirectory: join(root, 'profile'), launch: async () => ({ close }) });
    await manager.start();
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

  it('waits for an in-flight launch and closes the resulting browser', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xhs-profile-test-'));
    let finishLaunch!: (handle: { close(): Promise<void> }) => void;
    const close = vi.fn(async () => undefined);
    const launch = vi.fn(() => new Promise<{ close(): Promise<void> }>((resolve) => { finishLaunch = resolve; }));
    const manager = new LocalXhsSessionManager({ profileDirectory: join(root, 'profile'), launch });
    const starting = manager.start();
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce());
    const closing = manager.close();
    finishLaunch({ close });
    await starting;
    await expect(closing).resolves.toMatchObject({ state: 'closed' });
    expect(close).toHaveBeenCalledOnce();
    expect(manager.status()).toMatchObject({ state: 'closed' });
  });

  it('runs collection through the authenticated page adapter instead of a placeholder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xhs-profile-test-'));
    const manager = new LocalXhsSessionManager({
      profileDirectory: join(root, 'profile'),
      launch: async () => ({ close: async () => undefined }),
      adapter: {
        detectLoginState: async () => 'authenticated',
        captureQr: async () => Buffer.from([]),
        readAccountIdentity: async () => ({ platformId: 'user-collection', xhsAccountId: null, displayName: '本人账号', avatarUrl: null }),
        collectVisibleRecords: async () => ({
          notes: [{ platformId: 'note-1', title: '本人笔记', publishedAt: '2026-08-03T02:00:00.000Z', capturedAt: '2026-08-04T07:00:00.000Z', metrics: { views: null, likes: 5, comments: 0 } }],
          comments: [],
        }),
      },
    });
    const events: unknown[] = [];
    await manager.start();

    await manager.collect(() => undefined, (event) => events.push(event), 'run-collection', '2026-08-04T07:00:00.000Z');

    expect(events).toContainEqual(expect.objectContaining({ type: 'note', runId: 'run-collection' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'completed', runId: 'run-collection' }));
  });
});

function pngFixture(width: number, height: number) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
