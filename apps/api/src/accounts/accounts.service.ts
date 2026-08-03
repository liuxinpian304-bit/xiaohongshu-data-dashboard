import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { prisma } from '@xhs/database';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { page } from '../common/pagination.dto';
import { CredentialCipher } from '../security/credential-cipher';
import { ConnectorRegistry } from './connector-registry';

@Injectable()
export class AccountsService {
  constructor(@Inject(AuditService) private readonly audit: AuditService, @Optional() @Inject(ConnectorRegistry) private readonly connectors = new ConnectorRegistry()) {}
  async list(cursor: string | undefined, limit: number) {
    const items = await prisma.account.findMany({ where: cursor ? { id: { gt: cursor } } : undefined, orderBy: { id: 'asc' }, take: limit + 1, include: { capabilities: true } });
    return page(items, limit);
  }
  async listAuthorizedOfficial(cursor: string | undefined, limit: number, now = new Date()) {
    const items = await prisma.account.findMany({
      where: { connectorType: 'official', ...(cursor ? { id: { gt: cursor } } : {}), credentials: { some: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }, capabilities: { some: { enabled: true } } },
      orderBy: { id: 'asc' }, take: limit + 1, include: { capabilities: true },
    });
    return page(items, limit);
  }
  async authorize(input: { connectorType: string; platformId: string; displayName?: string; secret: string; kind: string }) {
    return prisma.$transaction(async (tx) => {
      const account = await tx.account.upsert({ where: { connectorType_platformId: { connectorType: input.connectorType, platformId: input.platformId } }, create: { connectorType: input.connectorType, platformId: input.platformId, displayName: input.displayName }, update: { displayName: input.displayName, revocationState: 'none', revocationRetainData: null, revocationRequestedAt: null, revocationFailure: null } });
      const credentialId = randomUUID(); const encrypted = new CredentialCipher().encrypt(input.secret, account.id, credentialId);
      const old = await tx.credential.findUnique({ where: { accountId_kind: { accountId: account.id, kind: input.kind } } });
      await tx.credential.create({ data: { id: credentialId, accountId: account.id, kind: `${input.kind}:pending:${credentialId}`, secret: encrypted } });
      if (old) await tx.credential.delete({ where: { id: old.id } });
      await tx.credential.update({ where: { id: credentialId }, data: { kind: input.kind } });
      await tx.auditLog.create({ data: { actor: 'admin', action: 'account.authorized', entityType: 'Account', entityId: account.id, details: { connectorType: input.connectorType } } });
      return tx.account.findUniqueOrThrow({ where: { id: account.id }, include: { capabilities: true } });
    });
  }
  async deactivate(id: string) {
    if (!(await prisma.account.count({ where: { id } }))) throw new NotFoundException('managed account not found');
    await prisma.connectorCapability.updateMany({ where: { accountId: id }, data: { enabled: false, checkedAt: new Date() } });
    await this.audit.record('account.deactivated', 'Account', id);
    return { id, active: false };
  }
  async reauthorize(id: string, secret: string, kind: string) {
    const account = await prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('managed account not found');
    const credentialId = randomUUID();
    const encrypted = new CredentialCipher().encrypt(secret, id, credentialId);
    return prisma.$transaction(async (tx) => {
      const old = await tx.credential.findUnique({ where: { accountId_kind: { accountId: id, kind } } });
      await tx.credential.create({ data: { id: credentialId, accountId: id, kind: `${kind}:pending:${credentialId}`, secret: encrypted } });
      if (old) await tx.credential.delete({ where: { id: old.id } });
      await tx.credential.update({ where: { id: credentialId }, data: { kind } });
      await tx.account.update({ where: { id }, data: { revocationState: 'none', revocationRetainData: null, revocationRequestedAt: null, revocationFailure: null } });
      await tx.auditLog.create({ data: { actor: 'admin', action: 'account.reauthorized', entityType: 'Account', entityId: id, details: { kind } } });
      return tx.account.findUniqueOrThrow({ where: { id }, include: { capabilities: true } });
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
    const connector = this.connectors.resolve(candidate.connectorType);
    const capabilities = connector ? await connector.getCapabilities() : undefined;
    const officialRevocationSupported = capabilities?.revokeAuthorization === true && typeof connector?.revokeAuthorization === 'function';
    const prepared = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${id}::uuid FOR UPDATE`;
      const account = await tx.account.findUnique({ where: { id }, include: { capabilities: true } });
      if (!account) return null;
      const hasHistoricalData = Boolean(await tx.note.count({ where: { accountId: id } }) || await tx.report.count({ where: { accountId: id } }));
      const requestedRetainData = account.revocationState === 'none' || account.revocationRetainData === null ? retainData : account.revocationRetainData;
      await tx.connectorCapability.updateMany({ where: { accountId: id }, data: { enabled: false, checkedAt: new Date() } });
      await tx.account.update({ where: { id }, data: { revocationState: 'pending', revocationRetainData: requestedRetainData, revocationRequestedAt: account.revocationRequestedAt ?? new Date(), revocationFailure: null } });
      await tx.auditLog.create({ data: { actor: 'admin', action: 'account.revocation.prepared', entityType: 'Account', entityId: id, details: { requestedRetainData, retainedBusinessData: requestedRetainData || hasHistoricalData, officialRevocationSupported } } });
      return { requestedRetainData };
    });
    if (!prepared) { const completed = await tombstone(); if (completed) return completed; throw new NotFoundException('managed account not found'); }
    try {
      if (officialRevocationSupported) await connector!.revokeAuthorization!({ accountId: id });
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      const state = /timeout|timed out|abort/i.test(failure) ? 'unknown' : 'failed';
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${id}::uuid FOR UPDATE`;
        if (await tx.account.count({ where: { id } })) {
          await tx.account.update({ where: { id }, data: { revocationState: state, revocationFailure: failure } });
          await tx.auditLog.create({ data: { actor: 'admin', action: 'account.revocation.failed', entityType: 'Account', entityId: id, details: { state, failure, officialRevocationSupported } } });
        }
      });
      throw error;
    }
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${id}::uuid FOR UPDATE`;
      const account = await tx.account.findUnique({ where: { id } });
      if (!account) { const completed = await tombstone(); if (completed) return completed; throw new NotFoundException('managed account not found'); }
      const hasHistoricalData = Boolean(await tx.note.count({ where: { accountId: id } }) || await tx.report.count({ where: { accountId: id } }));
      const retainedBusinessData = Boolean(account.revocationRetainData) || hasHistoricalData;
      await tx.credential.deleteMany({ where: { accountId: id } });
      await tx.auditLog.create({ data: { actor: 'admin', action: 'account.revocation.completed', entityType: 'Account', entityId: id, details: { requestedRetainData: Boolean(account.revocationRetainData), retainedBusinessData, officialRevocationSupported, revocation: officialRevocationSupported ? 'revoked' : 'unsupported' } } });
      if (retainedBusinessData) await tx.account.update({ where: { id }, data: { revocationState: 'completed', revocationFailure: null } });
      else await tx.account.delete({ where: { id } });
      return { id, retainedBusinessData, credentialsDeleted: true, officialRevocationSupported };
    });
  }
}
