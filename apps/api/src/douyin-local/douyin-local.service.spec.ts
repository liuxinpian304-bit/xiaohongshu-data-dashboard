import { describe, expect, it, vi } from 'vitest';

import { DouyinLocalService } from './douyin-local.service';

const token = 'd'.repeat(48);
const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const identity = { platformId: 'douyin:7390000000000000000', douyinAccountId: 'tonic123', displayName: 'Tonic', avatarUrl: null };

describe('DouyinLocalService', () => {
  it('binds only an authenticated identity verified by the collector', async () => {
    const upsert = vi.fn(async ({ create }) => ({ id: 'account-1', ...create }));
    const db = { account: { upsert } } as any;
    const fetcher = vi.fn(async () => Response.json({ sessionId, state: 'authenticated', changedAt: '2026-08-11T06:00:00.000Z', identity, identityVerifiedAt: '2026-08-11T06:00:00.000Z' }));
    const service = new DouyinLocalService({ enabled: true, url: 'http://127.0.0.1:43127', token, fetcher, db });

    await expect(service.status(sessionId)).resolves.toMatchObject({ state: 'authenticated', identity });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { connectorType_platformId: { connectorType: 'douyin-local', platformId: identity.platformId } },
      create: expect.objectContaining({ platform: 'douyin', source: 'self-scrape', connectorType: 'douyin-local', platformId: identity.platformId }),
    }));
  });

  it('rejects unknown collector fields before database access', async () => {
    const upsert = vi.fn();
    const fetcher = vi.fn(async () => Response.json({ sessionId, state: 'authenticated', changedAt: '2026-08-11T06:00:00.000Z', identity, identityVerifiedAt: '2026-08-11T06:00:00.000Z', cookie: 'secret' }));
    const service = new DouyinLocalService({ enabled: true, url: 'http://127.0.0.1:43127', token, fetcher, db: { account: { upsert } } as any });

    await expect(service.status(sessionId)).rejects.toThrow('invalid_douyin_collector_response');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('lists sessions without binding an idle placeholder', async () => {
    const upsert = vi.fn();
    const fetcher = vi.fn(async () => Response.json({ items: [{ sessionId, state: 'idle', changedAt: '1970-01-01T00:00:00.000Z' }] }));
    const service = new DouyinLocalService({ enabled: true, url: 'http://127.0.0.1:43127', token, fetcher, db: { account: { upsert } } as any });

    await expect(service.list()).resolves.toEqual({ items: [expect.objectContaining({ state: 'idle' })] });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('imports a completed account-scoped collection run', async () => {
    const importer = vi.fn(async () => ({ accountId: 'account-1', contentsChanged: 1, snapshotsChanged: 3, commentsChanged: 1, incompleteContents: 0, sha256: 'hash' }));
    const recorder = vi.fn(async () => undefined);
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/sessions/${sessionId}`)) return Response.json({ sessionId, state: 'authenticated', changedAt: '2026-08-11T06:00:00.000Z', identity, identityVerifiedAt: '2026-08-11T06:00:00.000Z' });
      if (url.endsWith('/collection/start') && init?.method === 'POST') return Response.json({ runId: 'run-dy-1', state: 'running', stage: 'account', processed: 0, total: 0, incompleteNotes: 0, changedAt: '2026-08-11T06:00:01.000Z' });
      if (url.endsWith('/collection/status')) return Response.json({ runId: 'run-dy-1', state: 'completed', stage: 'complete', processed: 1, total: 1, incompleteNotes: 0, changedAt: '2026-08-11T06:00:02.000Z' });
      if (url.includes('/collection/events?runId=')) return Response.json({ runId: 'run-dy-1', events: [{ version: 2, platform: 'douyin', source: 'self-scrape', runId: 'run-dy-1', type: 'account', account: { platformId: identity.platformId, displayName: identity.displayName, avatarUrl: null } }, { version: 2, platform: 'douyin', source: 'self-scrape', runId: 'run-dy-1', type: 'completed', completedAt: '2026-08-11T06:00:02.000Z' }] });
      throw new Error(`unexpected ${url}`);
    });
    const db = { account: { upsert: vi.fn(async () => ({})) } } as any;
    const service = new DouyinLocalService({ enabled: true, url: 'http://127.0.0.1:43127', token, fetcher, db, importer, recorder, sleep: async () => undefined });

    await expect(service.startCollection(sessionId)).resolves.toMatchObject({ runId: 'run-dy-1', state: 'running' });
    await vi.waitFor(() => expect(importer).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ platform: 'douyin', source: 'self-scrape', accountPlatformId: identity.platformId, runId: 'run-dy-1' })));
    await vi.waitFor(() => expect(recorder).toHaveBeenCalledWith('run-dy-1', expect.objectContaining({ accountId: 'account-1', contentsChanged: 1, commentsChanged: 1 })));
    await expect(service.collectionStatus(sessionId)).resolves.toMatchObject({ state: 'completed' });
  });

  it('records a completed run and warns when comments are incomplete', async () => {
    const tx = {
      syncJob: { upsert: vi.fn(async () => ({})) },
      notification: { upsert: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const transaction = vi.fn(async (work) => work(tx));
    const db = { $transaction: transaction } as any;
    const summary = { accountId: 'account-1', platform: 'douyin' as const, source: 'self-scrape' as const, contentsChanged: 2, snapshotsChanged: 6, commentsChanged: 4, incompleteContents: 1, sha256: 'hash' };

    await DouyinLocalService.recordImport(db, 'run-dy-incomplete', summary);

    expect(tx.syncJob.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ accountId: 'account-1', status: 'succeeded', currentStage: 'complete', payload: expect.objectContaining({ platform: 'douyin', incompleteContents: 1 }) }),
    }));
    expect(tx.notification.upsert).toHaveBeenCalledTimes(2);
    expect(tx.notification.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ type: 'comment_sync_incomplete', title: '抖音评论同步不完整' }) }));
  });
});
