import { describe, expect, it, vi } from 'vitest';
import { findUnverifiedDouyin, removeUnverifiedDouyin } from './remove-unverified-douyin';

describe('unverified Douyin cleanup', () => {
  it('selects only legacy unverified placeholders', async () => {
    const findMany = vi.fn(async () => []);
    await findUnverifiedDouyin({ account: { findMany } } as never);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { platform: 'douyin', identityVerifiedAt: null, connectorType: { in: ['xiaohuohua', 'mock'] } } }));
  });
  it('is dry-run by default and requires commit to delete scoped dependent rows', async () => {
    const account = { id: 'old', displayName: '抖音账号', platformId: 'creator-1', _count: { notes: 1 } };
    const db = { account: { findMany: vi.fn(async () => [account]) }, $transaction: vi.fn() } as never;
    await expect(removeUnverifiedDouyin(db, false)).resolves.toEqual({ committed: false, accounts: [account] });
    expect((db as any).$transaction).not.toHaveBeenCalled();
  });
});
