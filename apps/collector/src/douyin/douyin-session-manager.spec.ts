import { describe, expect, it, vi } from 'vitest';

import { DouyinSessionManager } from './douyin-session-manager';

const identity = { platformId: 'douyin:7390000000000000000', douyinAccountId: 'tonic123', displayName: 'Tonic', avatarUrl: null };
const record = { sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', platformId: null, profileDirectory: '/tmp/douyin-profile', identityVerifiedAt: null };

describe('DouyinSessionManager', () => {
  it('binds identity only after the official adapter verifies authentication', async () => {
    const bindIdentity = vi.fn(async () => ({ ...record, platformId: identity.platformId, identityVerifiedAt: 'verified' }));
    const manager = new DouyinSessionManager(record, {
      store: { bindIdentity } as never,
      adapter: { detectLoginState: async () => 'authenticated', readIdentity: async () => identity, captureQr: async () => Buffer.alloc(0) },
      launch: async () => ({ close: async () => undefined }),
    });

    const status = await manager.start();
    expect(status).toMatchObject({ state: 'authenticated', identity });
    expect(bindIdentity).toHaveBeenCalledWith(record.sessionId, identity, expect.any(String));
  });

  it('returns verification_required without attempting to bypass it', async () => {
    const bindIdentity = vi.fn();
    const manager = new DouyinSessionManager(record, {
      store: { bindIdentity } as never,
      adapter: { detectLoginState: async () => 'verification_required', readIdentity: async () => identity, captureQr: async () => Buffer.alloc(0) },
      launch: async () => ({ close: async () => undefined }),
    });

    await expect(manager.start()).resolves.toMatchObject({ state: 'verification_required' });
    expect(bindIdentity).not.toHaveBeenCalled();
  });

  it('reverifies the bound identity before starting an account-scoped collection', async () => {
    const collect = vi.fn(async (_identity, progress, emit, runId) => {
      progress({ stage: 'notes', processed: 1, total: 1, incompleteNotes: 0 });
      emit({ runId, type: 'completed' });
    });
    const manager = new DouyinSessionManager(record, {
      store: { bindIdentity: vi.fn() } as never,
      adapter: { detectLoginState: async () => 'authenticated', readIdentity: async () => identity, captureQr: async () => Buffer.alloc(0) },
      launch: async () => ({ close: async () => undefined }), collect,
    });
    await manager.start();
    const started = manager.startCollection();
    expect(started).toMatchObject({ state: 'running', stage: 'account', runId: expect.any(String) });
    await vi.waitFor(() => expect(manager.collectionStatus().state).toBe('completed'));
    expect(collect).toHaveBeenCalledWith(identity, expect.any(Function), expect.any(Function), started.runId);
    expect(manager.collectionEvents(started.runId!)).toEqual([{ runId: started.runId, type: 'completed' }]);
  });
});
