import { Pool, type PoolClient } from 'pg';

export type ProtectedCounts = { accountId: string; notes: number; snapshots: number; comments: number; syncJobs: number; reports: number };
export type CleanupSnapshot = {
  accounts: Array<{ id: string; connectorType: string; xhsAccountId: string | null }>;
  protected: ProtectedCounts | null;
};
export type CleanupPlan = { protected: ProtectedCounts; deleteAccountIds: string[] };
export type CleanupResult = CleanupPlan & { executed: boolean; deletedAccounts: number };
export type CleanupStore = {
  snapshot(protectedXhsAccountId: string): Promise<CleanupSnapshot>;
  deleteAccounts(ids: string[]): Promise<number>;
};

export async function planDemoCleanup(store: CleanupStore, protectedXhsAccountId: string): Promise<CleanupPlan> {
  const current = await store.snapshot(protectedXhsAccountId);
  const matching = current.accounts.filter((account) => account.connectorType === 'self-scrape' && account.xhsAccountId === protectedXhsAccountId);
  if (matching.length !== 1 || !current.protected || current.protected.accountId !== matching[0].id) throw new Error('protected self-scrape account not found');
  return { protected: current.protected, deleteAccountIds: current.accounts.filter((account) => account.connectorType !== 'self-scrape').map(({ id }) => id).sort() };
}

export async function removeDemoContent(store: CleanupStore, options: { protectedXhsAccountId: string; execute: boolean }): Promise<CleanupResult> {
  const plan = await planDemoCleanup(store, options.protectedXhsAccountId);
  if (!options.execute) return { ...plan, executed: false, deletedAccounts: 0 };
  const deletedAccounts = await store.deleteAccounts(plan.deleteAccountIds);
  const after = await store.snapshot(options.protectedXhsAccountId);
  if (!after.protected || JSON.stringify(after.protected) !== JSON.stringify(plan.protected)) throw new Error('protected account data changed');
  if (after.accounts.some((account) => account.connectorType !== 'self-scrape')) throw new Error('demo accounts remain after cleanup');
  return { ...plan, executed: true, deletedAccounts };
}

async function readSnapshot(client: Pick<PoolClient, 'query'>, protectedXhsAccountId: string): Promise<CleanupSnapshot> {
  const accounts = await client.query<{ id: string; connectorType: string; xhsAccountId: string | null }>(
    'SELECT id, "connectorType", "xhsAccountId" FROM "Account" ORDER BY id',
  );
  const protectedRows = await client.query<ProtectedCounts>(`
    SELECT a.id AS "accountId",
      (SELECT COUNT(*)::int FROM "Note" n WHERE n."accountId" = a.id) AS notes,
      (SELECT COUNT(*)::int FROM "MetricSnapshot" m JOIN "Note" n ON n.id = m."noteId" WHERE n."accountId" = a.id) AS snapshots,
      (SELECT COUNT(*)::int FROM "Comment" c JOIN "Note" n ON n.id = c."noteId" WHERE n."accountId" = a.id) AS comments,
      (SELECT COUNT(*)::int FROM "SyncJob" j WHERE j."accountId" = a.id) AS "syncJobs",
      (SELECT COUNT(*)::int FROM "Report" r WHERE r."accountId" = a.id) AS reports
    FROM "Account" a WHERE a."connectorType" = 'self-scrape' AND a."xhsAccountId" = $1
  `, [protectedXhsAccountId]);
  return { accounts: accounts.rows, protected: protectedRows.rows.length === 1 ? protectedRows.rows[0] : null };
}

export class PostgresCleanupStore implements CleanupStore {
  private readonly pool: Pool;
  constructor(url: string, private readonly protectedXhsAccountId: string) { this.pool = new Pool({ connectionString: url, max: 1 }); }
  async snapshot(protectedXhsAccountId: string) { return readSnapshot(this.pool, protectedXhsAccountId); }
  async close() { await this.pool.end(); }

  async deleteAccounts(ids: string[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const role = await client.query<{ allowed: boolean }>(`SELECT (r.rolsuper OR current_user = pg_get_userbyid(d.datdba)) AS allowed FROM pg_roles r CROSS JOIN pg_database d WHERE r.rolname = current_user AND d.datname = current_database()`);
      if (role.rows[0]?.allowed !== true) throw new Error('maintenance database owner connection is required');
      const protectedRow = await client.query('SELECT id FROM "Account" WHERE "connectorType" = \'self-scrape\' AND "xhsAccountId" = $1 FOR UPDATE', [this.protectedXhsAccountId]);
      if (protectedRow.rowCount !== 1) throw new Error('protected self-scrape account not found');
      const candidates = await client.query<{ id: string }>('SELECT id FROM "Account" WHERE "connectorType" <> \'self-scrape\' ORDER BY id FOR UPDATE');
      const currentIds = candidates.rows.map(({ id }) => id);
      if (JSON.stringify(currentIds) !== JSON.stringify([...ids].sort())) throw new Error('cleanup candidates changed; run dry-run again');
      if (ids.length) {
        await client.query('ALTER TABLE "MetricSnapshot" DISABLE TRIGGER "MetricSnapshot_prevent_delete"');
        await client.query('DELETE FROM "MetricSnapshot" m USING "Note" n WHERE m."noteId" = n.id AND n."accountId" = ANY($1::uuid[])', [ids]);
        await client.query('DELETE FROM "Comment" c USING "Note" n WHERE c."noteId" = n.id AND n."accountId" = ANY($1::uuid[])', [ids]);
        await client.query('DELETE FROM "Report" WHERE "accountId" = ANY($1::uuid[])', [ids]);
        await client.query('DELETE FROM "Note" WHERE "accountId" = ANY($1::uuid[])', [ids]);
        await client.query('DELETE FROM "AuditLog" WHERE "entityType" = \'Account\' AND "entityId" = ANY($1::text[])', [ids]);
        await client.query('DELETE FROM "Account" WHERE id = ANY($1::uuid[])', [ids]);
        await client.query('ALTER TABLE "MetricSnapshot" ENABLE TRIGGER "MetricSnapshot_prevent_delete"');
      }
      await client.query(`DELETE FROM "MetricDefinition" d WHERE d.key NOT IN ('views','likes','comments') AND NOT EXISTS (SELECT 1 FROM "MetricSnapshot" m WHERE m."metricDefinitionId"=d.id) AND NOT EXISTS (SELECT 1 FROM "ReportMetric" r WHERE r."metricDefinitionId"=d.id)`);
      const after = await readSnapshot(client, this.protectedXhsAccountId);
      if (!after.protected || after.accounts.some((account) => account.connectorType !== 'self-scrape')) throw new Error('cleanup verification failed');
      await client.query('COMMIT');
      return ids.length;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
