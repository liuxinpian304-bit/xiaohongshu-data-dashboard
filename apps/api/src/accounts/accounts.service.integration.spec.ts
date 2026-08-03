import { prisma } from '@xhs/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsService } from './accounts.service';
import { AuditService } from '../common/audit.service';
const registry = (entries: Array<[string, unknown]>) => ({ resolve: (type: string) => new Map(entries).get(type) }) as never;

describe('account credential lifecycle', () => {
  beforeEach(async () => { await prisma.auditLog.deleteMany(); await prisma.account.deleteMany({ where: { notes: { none: {} }, reports: { none: {} } } }); process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64'); });
  it('returns the complete public account projection from authorize and reauthorize', async () => {
    const service = new AccountsService(new AuditService());
    const created = await service.authorize({ connectorType: `projection-${crypto.randomUUID()}`, platformId: crypto.randomUUID(), displayName: 'Projection', secret: 'first', kind: 'oauth' });
    expect(created).toMatchObject({ displayName: 'Projection', capabilities: [] });
    const updated = await service.reauthorize(created.id, 'second', 'oauth');
    expect(updated).toMatchObject({ id: created.id, capabilities: [] });
  });
  it('revokes connector authorization before atomically deleting local credentials', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'encrypted' } } } });
    const connector = { getCapabilities: vi.fn(async () => ({ revokeAuthorization: true })), revokeAuthorization: vi.fn(async () => ({ revoked: true as const })) };
    await new AccountsService(new AuditService(), registry([['mock', connector]])).remove(account.id, true);
    expect(connector.revokeAuthorization).toHaveBeenCalledWith({ accountId: account.id });
    expect(await prisma.credential.count({ where: { accountId: account.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: account.id, action: 'account.deleted' } })).toBe(1);
  });
  it('reports unsupported from the resolved connector capability without revoking', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'official-x', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'encrypted' } } } });
    const connector = { getCapabilities: vi.fn(async () => ({ revokeAuthorization: false })), revokeAuthorization: vi.fn() };
    const result = await new AccountsService(new AuditService(), registry([['official-x', connector]])).remove(account.id, true);
    expect(result.officialRevocationSupported).toBe(false); expect(connector.revokeAuthorization).not.toHaveBeenCalled();
  });
  it('preserves local credentials when the resolved connector revocation fails', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'official-y', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'encrypted' } } } });
    const connector = { getCapabilities: vi.fn(async () => ({ revokeAuthorization: true })), revokeAuthorization: vi.fn(async () => { throw new Error('remote unavailable'); }) };
    await expect(new AccountsService(new AuditService(), registry([['official-y', connector]])).remove(account.id, true)).rejects.toThrow('remote unavailable');
    expect(await prisma.credential.count({ where: { accountId: account.id } })).toBe(1);
  });
  it('preserves the old credential when replacement encryption fails', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'old' } } } });
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'invalid';
    await expect(new AccountsService(new AuditService()).reauthorize(account.id, 'new', 'oauth')).rejects.toThrow();
    expect((await prisma.credential.findFirstOrThrow({ where: { accountId: account.id } })).secret).toBe('old');
  });
  it('paginates only active authorized official accounts and excludes retained/deactivated records', async () => {
    const make = (platformId: string, expiresAt: Date | null, enabled: boolean, connectorType = 'official') => prisma.account.create({ data: { connectorType, platformId, credentials: { create: { kind: 'oauth', secret: 'encrypted', expiresAt } }, capabilities: { create: { capability: 'noteMetrics', enabled } } } });
    const active = await Promise.all([make('active-1', null, true), make('active-2', new Date(Date.now() + 60_000), true), make('active-3', null, true)]);
    await make('expired', new Date(0), true); await make('deactivated', null, false); await make('mock', null, true, 'mock');
    const service = new AccountsService(new AuditService());
    const first = await service.listAuthorizedOfficial(undefined, 2); const second = await service.listAuthorizedOfficial(first.pageInfo.nextCursor!, 2);
    expect([...first.items, ...second.items].map(({ id }) => id).sort()).toEqual(active.map(({ id }) => id).sort());
    expect(first.pageInfo.hasMore).toBe(true); expect(second.pageInfo.hasMore).toBe(false);
  });
  it('retains historical evidence when business-data deletion is requested', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'official-delete', platformId: crypto.randomUUID() } });
    const note = await prisma.note.create({ data: { accountId: account.id, connectorType: account.connectorType, platformId: crypto.randomUUID(), title: 'Historical', publishedAt: new Date() } });
    const definition = await prisma.metricDefinition.create({ data: { key: `delete-${crypto.randomUUID()}`, displayName: 'Historical', unit: 'count', source: 'official-delete', version: 'v1' } });
    await prisma.metricSnapshot.create({ data: { noteId: note.id, metricDefinitionId: definition.id, availability: 'available', value: 1, capturedAt: new Date(), source: 'official-delete' } });
    const result = await new AccountsService(new AuditService()).remove(account.id, false);
    expect(result.retainedBusinessData).toBe(true);
    expect(await prisma.metricSnapshot.count({ where: { noteId: note.id } })).toBe(1);
  });
});
