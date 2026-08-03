import { prisma } from '@xhs/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsService } from './accounts.service';
import { AuditService } from '../common/audit.service';
const registry = (entries: Array<[string, unknown]>) => ({ resolve: (type: string) => new Map(entries).get(type) }) as never;

describe('account credential lifecycle', () => {
  const removeFinalizeFailure = async () => { await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_revocation_finalize ON "AuditLog"`); await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_revocation_finalize_once()`); };
  beforeEach(async () => { await removeFinalizeFailure(); await prisma.auditLog.deleteMany(); await prisma.account.deleteMany({ where: { notes: { none: {} }, reports: { none: {} } } }); process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64'); });
  afterEach(removeFinalizeFailure);
  it('returns the complete public account projection from authorize and reauthorize', async () => {
    const service = new AccountsService(new AuditService());
    const created = await service.authorize({ connectorType: `projection-${crypto.randomUUID()}`, platformId: crypto.randomUUID(), displayName: 'Projection', secret: 'first', kind: 'oauth' });
    expect(created).toMatchObject({ displayName: 'Projection', capabilities: [] });
    const updated = await service.reauthorize(created.id, 'second', 'oauth');
    expect(updated).toMatchObject({ id: created.id, capabilities: [] });
  });
  it('revokes connector authorization before finalizing local credential deletion', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'encrypted' } } } });
    const connector = { getCapabilities: vi.fn(async () => ({ revokeAuthorization: true })), revokeAuthorization: vi.fn(async () => ({ revoked: true as const })) };
    await new AccountsService(new AuditService(), registry([['mock', connector]])).remove(account.id, true);
    expect(connector.revokeAuthorization).toHaveBeenCalledWith({ accountId: account.id });
    expect(await prisma.credential.count({ where: { accountId: account.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: account.id, action: 'account.revocation.completed' } })).toBe(1);
  });
  it('reports unsupported from the resolved connector capability without revoking', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'official-x', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'encrypted' } } } });
    const connector = { getCapabilities: vi.fn(async () => ({ revokeAuthorization: false })), revokeAuthorization: vi.fn() };
    const result = await new AccountsService(new AuditService(), registry([['official-x', connector]])).remove(account.id, true);
    expect(result.officialRevocationSupported).toBe(false); expect(connector.revokeAuthorization).not.toHaveBeenCalled();
  });
  it('preserves local credentials when the resolved connector revocation fails', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'official-y', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'encrypted' } }, capabilities: { create: { capability: 'noteMetrics', enabled: true } } } });
    const connector = { getCapabilities: vi.fn(async () => ({ revokeAuthorization: true })), revokeAuthorization: vi.fn(async () => { throw new Error('remote unavailable'); }) };
    await expect(new AccountsService(new AuditService(), registry([['official-y', connector]])).remove(account.id, true)).rejects.toThrow('remote unavailable');
    expect(await prisma.credential.count({ where: { accountId: account.id } })).toBe(1);
    expect(await prisma.connectorCapability.findFirstOrThrow({ where: { accountId: account.id } })).toMatchObject({ enabled: false });
    expect(await prisma.$queryRaw<Array<{ revocationState: string }>>`SELECT "revocationState" FROM "Account" WHERE id = ${account.id}::uuid`).toEqual([{ revocationState: 'failed' }]);
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
  it('allows concurrent historical note and report inserts during remote revocation and retains them', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'official-race', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'encrypted' } } } });
    let release!: () => void; let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
    const connector = { getCapabilities: async () => ({ revokeAuthorization: true }), revokeAuthorization: async () => { started(); await gate; return { revoked: true as const }; } };
    const removal = new AccountsService(new AuditService(), registry([['official-race', connector]])).remove(account.id, false);
    await entered;
    expect(await prisma.connectorCapability.count({ where: { accountId: account.id, enabled: true } })).toBe(0);
    expect(await prisma.credential.count({ where: { accountId: account.id } })).toBe(1);
    const noteInsert = prisma.note.create({ data: { accountId: account.id, connectorType: account.connectorType, platformId: crypto.randomUUID(), title: 'Race', publishedAt: new Date() } });
    const reportInsert = prisma.report.create({ data: { accountId: account.id, reportType: 'daily', periodStart: new Date('2026-08-01T00:00:00Z'), periodEnd: new Date('2026-08-01T23:59:59.999Z') } });
    let noteInsertedDuringRemote = false; let reportInsertedDuringRemote = false;
    void noteInsert.then(() => { noteInsertedDuringRemote = true; }); void reportInsert.then(() => { reportInsertedDuringRemote = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const insertedBeforeRelease = noteInsertedDuringRemote && reportInsertedDuringRemote;
    release();
    await expect(noteInsert).resolves.toBeDefined();
    await expect(reportInsert).resolves.toBeDefined();
    await expect(removal).resolves.toMatchObject({ retainedBusinessData: true });
    expect(insertedBeforeRelease).toBe(true);
    expect(await prisma.account.count({ where: { id: account.id } })).toBe(1);
  });
  it('rejects reauthorization while remote revocation is pending and completes the original intent', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'official-reauthorize-race', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'old-encrypted' } }, capabilities: { create: { capability: 'noteMetrics', enabled: true } } } });
    let release!: () => void; let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
    const connector = { getCapabilities: async () => ({ revokeAuthorization: true }), revokeAuthorization: async () => { started(); await gate; return { revoked: true as const }; } };
    const service = new AccountsService(new AuditService(), registry([['official-reauthorize-race', connector]]));
    const removal = service.remove(account.id, true);
    await entered;
    await expect(service.reauthorize(account.id, 'replacement', 'oauth')).rejects.toMatchObject({ status: 409 });
    expect((await prisma.credential.findFirstOrThrow({ where: { accountId: account.id } })).secret).toBe('old-encrypted');
    release();
    await expect(removal).resolves.toMatchObject({ retainedBusinessData: true, credentialsDeleted: true });
    expect(await prisma.credential.count({ where: { accountId: account.id } })).toBe(0);
  });
  it('does not let a stale successful revocation delete a newer credential or overwrite a newer intent', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'official-stale-success', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'old-encrypted' } } } });
    let release!: () => void; let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
    const connector = { getCapabilities: async () => ({ revokeAuthorization: true }), revokeAuthorization: async () => { started(); await gate; return { revoked: true as const }; } };
    const service = new AccountsService(new AuditService(), registry([['official-stale-success', connector]]));
    const removal = service.remove(account.id, true);
    await entered;
    const newerOperationId = crypto.randomUUID();
    await prisma.$executeRaw`UPDATE "Account" SET "revocationOperationId" = ${newerOperationId}::uuid, "revocationState" = 'pending' WHERE id = ${account.id}::uuid`;
    await prisma.credential.deleteMany({ where: { accountId: account.id } });
    await prisma.credential.create({ data: { accountId: account.id, kind: 'oauth', secret: 'new-encrypted' } });
    release();
    await expect(removal).rejects.toMatchObject({ status: 409 });
    expect((await prisma.credential.findFirstOrThrow({ where: { accountId: account.id } })).secret).toBe('new-encrypted');
    expect(await prisma.$queryRaw<Array<{ revocationState: string; revocationOperationId: string }>>`SELECT "revocationState", "revocationOperationId"::text FROM "Account" WHERE id = ${account.id}::uuid`).toEqual([{ revocationState: 'pending', revocationOperationId: newerOperationId }]);
  });
  it('does not let a stale failed revocation overwrite a newer intent', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'official-stale-failure', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'new-encrypted' } } } });
    let rejectRemote!: (error: Error) => void; let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; }); const gate = new Promise<never>((_, reject) => { rejectRemote = reject; });
    const connector = { getCapabilities: async () => ({ revokeAuthorization: true }), revokeAuthorization: async () => { started(); return gate; } };
    const service = new AccountsService(new AuditService(), registry([['official-stale-failure', connector]]));
    const removal = service.remove(account.id, true);
    await entered;
    const newerOperationId = crypto.randomUUID();
    await prisma.$executeRaw`UPDATE "Account" SET "revocationOperationId" = ${newerOperationId}::uuid, "revocationState" = 'pending', "revocationFailure" = NULL WHERE id = ${account.id}::uuid`;
    rejectRemote(new Error('old remote failed'));
    await expect(removal).rejects.toThrow('old remote failed');
    expect(await prisma.$queryRaw<Array<{ revocationState: string; revocationOperationId: string; revocationFailure: string | null }>>`SELECT "revocationState", "revocationOperationId"::text, "revocationFailure" FROM "Account" WHERE id = ${account.id}::uuid`).toEqual([{ revocationState: 'pending', revocationOperationId: newerOperationId, revocationFailure: null }]);
  });
  it('handles repeated successful callbacks for the same operation idempotently', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'official-duplicate-callback', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'encrypted' } } } });
    let arrivals = 0; let release!: () => void;
    const bothEntered = new Promise<void>((resolve) => { release = resolve; });
    const connector = { getCapabilities: async () => ({ revokeAuthorization: true }), revokeAuthorization: async () => { arrivals += 1; if (arrivals === 2) release(); await bothEntered; return { revoked: true as const }; } };
    const service = new AccountsService(new AuditService(), registry([['official-duplicate-callback', connector]]));
    const results = await Promise.all([service.remove(account.id, true), service.remove(account.id, true)]);
    expect(results).toEqual([expect.objectContaining({ retainedBusinessData: true }), expect.objectContaining({ retainedBusinessData: true })]);
    expect(await prisma.credential.count({ where: { accountId: account.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: account.id, action: 'account.revocation.completed' } })).toBe(1);
  });
  it('retries a failed revocation from persisted disabled state and finalizes once', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'official-retry', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'encrypted' } }, capabilities: { create: { capability: 'noteMetrics', enabled: true } } } });
    let attempts = 0;
    const connector = { getCapabilities: async () => ({ revokeAuthorization: true }), revokeAuthorization: async () => { attempts += 1; if (attempts === 1) throw new Error('temporary'); return { revoked: true as const }; } };
    const service = new AccountsService(new AuditService(), registry([['official-retry', connector]]));
    await expect(service.remove(account.id, true)).rejects.toThrow('temporary');
    await expect(service.remove(account.id, false)).resolves.toMatchObject({ retainedBusinessData: true, credentialsDeleted: true });
    expect(attempts).toBe(2);
    expect(await prisma.credential.count({ where: { accountId: account.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: account.id, action: 'account.revocation.completed' } })).toBe(1);
  });
  it('keeps pending state when remote succeeds but finalization fails, then idempotently retries', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'official-finalize-retry', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'encrypted' } }, capabilities: { create: { capability: 'noteMetrics', enabled: true } } } });
    await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_revocation_finalize_once() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'account.revocation.completed' THEN RAISE EXCEPTION 'finalize unavailable'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_revocation_finalize BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_revocation_finalize_once()`);
    const connector = { getCapabilities: async () => ({ revokeAuthorization: true }), revokeAuthorization: vi.fn(async () => ({ revoked: true as const })) };
    const service = new AccountsService(new AuditService(), registry([['official-finalize-retry', connector]]));
    await expect(service.remove(account.id, true)).rejects.toThrow('finalize unavailable');
    expect(await prisma.credential.count({ where: { accountId: account.id } })).toBe(1);
    expect(await prisma.connectorCapability.count({ where: { accountId: account.id, enabled: true } })).toBe(0);
    expect(await prisma.$queryRaw<Array<{ revocationState: string }>>`SELECT "revocationState" FROM "Account" WHERE id = ${account.id}::uuid`).toEqual([{ revocationState: 'pending' }]);
    await prisma.$executeRawUnsafe(`DROP TRIGGER fail_revocation_finalize ON "AuditLog"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION fail_revocation_finalize_once()`);
    await expect(service.remove(account.id, false)).resolves.toMatchObject({ retainedBusinessData: true });
    expect(connector.revokeAuthorization).toHaveBeenCalledTimes(2);
  });
  it('returns the completed tombstone for a repeated delete after account removal', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'local-delete', platformId: crypto.randomUUID(), credentials: { create: { kind: 'oauth', secret: 'encrypted' } } } });
    const service = new AccountsService(new AuditService());
    await expect(service.remove(account.id, false)).resolves.toMatchObject({ retainedBusinessData: false });
    await expect(service.remove(account.id, false)).resolves.toMatchObject({ id: account.id, retainedBusinessData: false, credentialsDeleted: true });
  });
});
