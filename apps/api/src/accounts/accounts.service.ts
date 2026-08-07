import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { prisma } from '@xhs/database';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { page } from '../common/pagination.dto';
import { CredentialCipher } from '../security/credential-cipher';
import { ConnectorRegistry } from './connector-registry';

const publicAccountSelect = { id: true, connectorType: true, platformId: true, xhsAccountId: true, displayName: true, avatarUrl: true, identityVerifiedAt: true, createdAt: true, updatedAt: true, capabilities: true } as const;

@Injectable()
export class AccountsService {
  constructor(@Inject(AuditService) private readonly audit: AuditService, @Optional() @Inject(ConnectorRegistry) private readonly connectors = new ConnectorRegistry()) {}
  async list(cursor: string | undefined, limit: number) {
    const items = await prisma.account.findMany({ where: cursor ? { id: { gt: cursor } } : undefined, orderBy: { id: 'asc' }, take: limit + 1, select: publicAccountSelect });
    return page(items, limit);
  }
  async listAuthorizedOfficial(cursor: string | undefined, limit: number, now = new Date()) {
    const items = await prisma.account.findMany({
      where: { connectorType: 'official', ...(cursor ? { id: { gt: cursor } } : {}), credentials: { some: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }, capabilities: { some: { enabled: true } } },
      orderBy: { id: 'asc' }, take: limit + 1, select: publicAccountSelect,
    });
    return page(items, limit);
  }
  async authorize(input: { connectorType: string; platformId: string; displayName?: string; secret: string; kind: string }): Promise<{ id: string }> {
    void input;
    throw new ForbiddenException('connector authorization is not available');
  }
  async deactivate(id: string) {
    const account = await prisma.account.findUnique({ where: { id }, select: { connectorType: true } }); if (!account) throw new NotFoundException('managed account not found'); if (['official', 'self_import'].includes(account.connectorType)) throw new ForbiddenException('connector management is not available');
    await prisma.connectorCapability.updateMany({ where: { accountId: id }, data: { enabled: false, checkedAt: new Date() } });
    await this.audit.record('account.deactivated', 'Account', id);
    return { id, active: false };
  }
  async reauthorize(id: string, secret: string, kind: string) {
    const candidate = await prisma.account.findUnique({ where: { id }, select: { connectorType: true } }); if (!candidate) throw new NotFoundException('managed account not found'); if (['official', 'self_import'].includes(candidate.connectorType)) throw new ForbiddenException('connector authorization is not available');
    const credentialId = randomUUID();
    const encrypted = new CredentialCipher().encrypt(secret, id, credentialId);
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ revocationState: string }>>`SELECT "revocationState" FROM "Account" WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked[0]) throw new NotFoundException('managed account not found');
      if (!['none', 'completed'].includes(locked[0].revocationState)) throw new ConflictException('account revocation is not complete');
      const old = await tx.credential.findUnique({ where: { accountId_kind: { accountId: id, kind } } });
      await tx.credential.create({ data: { id: credentialId, accountId: id, kind: `${kind}:pending:${credentialId}`, secret: encrypted } });
      if (old) await tx.credential.delete({ where: { id: old.id } });
      await tx.credential.update({ where: { id: credentialId }, data: { kind } });
      await tx.account.update({ where: { id }, data: { revocationState: 'none', revocationRetainData: null, revocationRequestedAt: null, revocationFailure: null, revocationOperationId: null } });
      await tx.auditLog.create({ data: { actor: 'admin', action: 'account.reauthorized', entityType: 'Account', entityId: id, details: { kind } } });
      return tx.account.findUniqueOrThrow({ where: { id }, select: publicAccountSelect });
    });
  }
  async remove(id: string, retainData: boolean) {
    const tombstone = async () => {
      const completed = await prisma.auditLog.findFirst({ where: { entityType: 'Account', entityId: id, action: 'account.revocation.completed' }, orderBy: { createdAt: 'desc' } });
      const details = completed?.details && typeof completed.details === 'object' && !Array.isArray(completed.details) ? completed.details as Record<string, unknown> : undefined;
      return completed ? { id, retainedBusinessData: details?.retainedBusinessData === true, credentialsDeleted: true, officialRevocationSupported: details?.officialRevocationSupported === true } : null;
    };
    const candidate = await prisma.account.findUnique({ where: { id }, select: { connectorType: true } });
    if (!candidate) { const completed = await tombstone(); if (completed) return completed; throw new NotFoundException('managed account not found'); }
    if (['official', 'self_import'].includes(candidate.connectorType)) throw new ForbiddenException('connector management is not available');
    const connector = this.connectors.resolve(candidate.connectorType);
    const capabilities = connector ? await connector.getCapabilities() : undefined;
    const officialRevocationSupported = capabilities?.revokeAuthorization === true && typeof connector?.revokeAuthorization === 'function';
    const prepared = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${id}::uuid FOR UPDATE`;
      const account = await tx.account.findUnique({ where: { id }, include: { capabilities: true } });
      if (!account) return null;
      const hasHistoricalData = Boolean(await tx.note.count({ where: { accountId: id } }) || await tx.report.count({ where: { accountId: id } }));
      if (account.revocationState === 'completed') return { completed: true as const, operationId: account.revocationOperationId };
      const requestedRetainData = account.revocationState === 'none' || account.revocationRetainData === null ? retainData : account.revocationRetainData;
      const operationId = account.revocationState === 'none' ? randomUUID() : account.revocationOperationId ?? randomUUID();
      await tx.connectorCapability.updateMany({ where: { accountId: id }, data: { enabled: false, checkedAt: new Date() } });
      await tx.account.update({ where: { id }, data: { revocationState: 'pending', revocationOperationId: operationId, revocationRetainData: requestedRetainData, revocationRequestedAt: account.revocationRequestedAt ?? new Date(), revocationFailure: null } });
      await tx.auditLog.create({ data: { actor: 'admin', action: 'account.revocation.prepared', entityType: 'Account', entityId: id, details: { operationId, requestedRetainData, retainedBusinessData: requestedRetainData || hasHistoricalData, officialRevocationSupported } } });
      return { completed: false as const, operationId, requestedRetainData };
    });
    if (!prepared) { const completed = await tombstone(); if (completed) return completed; throw new NotFoundException('managed account not found'); }
    if (prepared.completed) { const completed = await tombstone(); if (completed) return completed; throw new ConflictException('account revocation completion is unavailable'); }
    try {
      if (officialRevocationSupported) await connector!.revokeAuthorization!({ accountId: id });
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      const state = /timeout|timed out|abort/i.test(failure) ? 'unknown' : 'failed';
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${id}::uuid FOR UPDATE`;
        const claimed = await tx.account.updateMany({ where: { id, revocationOperationId: prepared.operationId, revocationState: 'pending' }, data: { revocationState: state, revocationFailure: failure } });
        if (claimed.count === 1) {
          await tx.auditLog.create({ data: { actor: 'admin', action: 'account.revocation.failed', entityType: 'Account', entityId: id, details: { state, failure, officialRevocationSupported } } });
        }
      });
      throw error;
    }
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${id}::uuid FOR UPDATE`;
      const account = await tx.account.findUnique({ where: { id } });
      if (!account) { const completed = await tombstone(); if (completed) return completed; throw new NotFoundException('managed account not found'); }
      const claimed = await tx.account.updateMany({ where: { id, revocationOperationId: prepared.operationId, revocationState: 'pending' }, data: { revocationState: 'completed', revocationFailure: null } });
      if (claimed.count === 0) {
        if (account.revocationOperationId === prepared.operationId && account.revocationState === 'completed') { const completed = await tombstone(); if (completed) return completed; }
        throw new ConflictException('stale account revocation callback');
      }
      const hasHistoricalData = Boolean(await tx.note.count({ where: { accountId: id } }) || await tx.report.count({ where: { accountId: id } }));
      const retainedBusinessData = Boolean(account.revocationRetainData) || hasHistoricalData;
      await tx.credential.deleteMany({ where: { accountId: id } });
      await tx.auditLog.create({ data: { actor: 'admin', action: 'account.revocation.completed', entityType: 'Account', entityId: id, details: { requestedRetainData: Boolean(account.revocationRetainData), retainedBusinessData, officialRevocationSupported, revocation: officialRevocationSupported ? 'revoked' : 'unsupported' } } });
      if (!retainedBusinessData) await tx.account.delete({ where: { id } });
      return { id, retainedBusinessData, credentialsDeleted: true, officialRevocationSupported };
    });
  }
}
