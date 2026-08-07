import { describe, expect, it } from 'vitest';

import { planDemoCleanup, removeDemoContent, type CleanupSnapshot, type CleanupStore } from './demo-content-cleanup';

const protectedCounts = { accountId: 'real-id', notes: 10, snapshots: 30, comments: 4, syncJobs: 1, reports: 2 };
const snapshot: CleanupSnapshot = {
  accounts: [
    { id: 'real-id', connectorType: 'self-scrape', xhsAccountId: '95874286519' },
    { id: 'mock-id', connectorType: 'mock', xhsAccountId: null },
    { id: 'official-test-id', connectorType: 'official-test', xhsAccountId: null },
  ],
  protected: protectedCounts,
};

class FakeStore implements CleanupStore {
  deleted: string[][] = [];
  constructor(private readonly snapshots: CleanupSnapshot[]) {}
  async snapshot() { return this.snapshots[Math.min(this.deleted.length, this.snapshots.length - 1)]; }
  async deleteAccounts(ids: string[]) { this.deleted.push(ids); return ids.length; }
}

describe('demo content cleanup safeguards', () => {
  it('refuses to plan cleanup without exactly one protected real account', async () => {
    const store = new FakeStore([{ accounts: snapshot.accounts.slice(1), protected: null }]);
    await expect(planDemoCleanup(store, '95874286519')).rejects.toThrow('protected self-scrape account not found');
  });

  it('selects every non-real account and leaves dry-run read-only', async () => {
    const store = new FakeStore([snapshot]);
    const result = await removeDemoContent(store, { protectedXhsAccountId: '95874286519', execute: false });
    expect(result).toEqual({ protected: protectedCounts, deleteAccountIds: ['mock-id', 'official-test-id'], executed: false, deletedAccounts: 0 });
    expect(store.deleted).toEqual([]);
  });

  it('rejects execution when protected business counts change', async () => {
    const changed = { ...snapshot, protected: { ...protectedCounts, notes: 9 } };
    const store = new FakeStore([snapshot, changed]);
    await expect(removeDemoContent(store, { protectedXhsAccountId: '95874286519', execute: true })).rejects.toThrow('protected account data changed');
  });
});
