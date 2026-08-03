import { describe, expect, it } from 'vitest';
import { databaseUrlFromEnvironment, verifyRuntimeDatabaseRole } from './client';

const client = (row: Record<string, unknown>) => ({ $queryRaw: async () => [row] }) as never;

describe('runtime database startup guard', () => {
  it('fails closed when DATABASE_URL is missing', () => {
    expect(() => databaseUrlFromEnvironment({})).toThrow('DATABASE_URL is required');
  });

  it('rejects a database owner when no explicit test bypass boolean is present', async () => {
    await expect(verifyRuntimeDatabaseRole(client({ currentUser: 'app_owner', isSuperuser: false, isDatabaseOwner: true, canUpdate: false, canDelete: false, canTruncate: false }), { NODE_ENV: 'test' })).rejects.toThrow('not safely restricted');
  });

  it('rejects a role with any direct evidence mutation privilege', async () => {
    await expect(verifyRuntimeDatabaseRole(client({ currentUser: 'app', isSuperuser: false, isDatabaseOwner: false, canUpdate: true, canDelete: false, canTruncate: false }), {})).rejects.toThrow('not safely restricted');
  });

  it('accepts a restricted runtime role by default', async () => {
    await expect(verifyRuntimeDatabaseRole(client({ currentUser: 'xhs_runtime', isSuperuser: false, isDatabaseOwner: false, canUpdate: false, canDelete: false, canTruncate: false }), {})).resolves.toBeUndefined();
  });

  it('allows a privileged role only with the exact two-part test bypass', async () => {
    const owner = client({ currentUser: 'app_owner', isSuperuser: false, isDatabaseOwner: true, canUpdate: true, canDelete: true, canTruncate: true });
    await expect(verifyRuntimeDatabaseRole(owner, { NODE_ENV: 'production', DATABASE_ALLOW_PRIVILEGED_TEST_ROLE: 'true' })).rejects.toThrow();
    await expect(verifyRuntimeDatabaseRole(owner, { NODE_ENV: 'test', DATABASE_ALLOW_PRIVILEGED_TEST_ROLE: 'TRUE' })).rejects.toThrow();
    await expect(verifyRuntimeDatabaseRole(owner, { NODE_ENV: 'test', DATABASE_ALLOW_PRIVILEGED_TEST_ROLE: 'true' })).resolves.toBeUndefined();
  });
});
