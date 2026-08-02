import { prisma } from '@xhs/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsService } from './accounts.service';
import { AuditService } from '../common/audit.service';

describe('account credential lifecycle', () => {
  beforeEach(async () => { await prisma.auditLog.deleteMany(); await prisma.account.deleteMany(); process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64'); });
  it('revokes connector authorization before atomically deleting local credentials', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'encrypted' } } } });
    const connector = { revokeAuthorization: vi.fn(async () => ({ revoked: true as const })) };
    await new AccountsService(new AuditService(), connector).remove(account.id, true);
    expect(connector.revokeAuthorization).toHaveBeenCalledWith({ accountId: account.id });
    expect(await prisma.credential.count({ where: { accountId: account.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: account.id, action: 'account.deleted' } })).toBe(1);
  });
  it('preserves the old credential when replacement encryption fails', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'old' } } } });
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'invalid';
    await expect(new AccountsService(new AuditService()).reauthorize(account.id, 'new', 'oauth')).rejects.toThrow();
    expect((await prisma.credential.findFirstOrThrow({ where: { accountId: account.id } })).secret).toBe('old');
  });
});
