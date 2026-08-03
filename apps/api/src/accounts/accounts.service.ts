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
      const account = await tx.account.upsert({ where: { connectorType_platformId: { connectorType: input.connectorType, platformId: input.platformId } }, create: { connectorType: input.connectorType, platformId: input.platformId, displayName: input.displayName }, update: { displayName: input.displayName } });
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
      await tx.auditLog.create({ data: { actor: 'admin', action: 'account.reauthorized', entityType: 'Account', entityId: id, details: { kind } } });
      return tx.account.findUniqueOrThrow({ where: { id }, include: { capabilities: true } });
    });
  }
  async remove(id: string, retainData: boolean) {
    const account = await prisma.account.findUnique({ where: { id }, include: { capabilities: true } });
    if (!account) throw new NotFoundException('managed account not found');
    const connector = this.connectors.resolve(account.connectorType); const capabilities = connector ? await connector.getCapabilities() : undefined;
    const officialRevocationSupported = capabilities?.revokeAuthorization === true && typeof connector?.revokeAuthorization === 'function';
    if (officialRevocationSupported) await connector!.revokeAuthorization!({ accountId: id });
    const hasHistoricalData = Boolean(await prisma.note.count({ where: { accountId: id } }) || await prisma.report.count({ where: { accountId: id } }));
    const retainedBusinessData = retainData || hasHistoricalData;
    await prisma.$transaction(async (tx) => {
      await tx.credential.deleteMany({ where: { accountId: id } });
      if (!retainedBusinessData) await tx.account.delete({ where: { id } });
      else await tx.connectorCapability.updateMany({ where: { accountId: id }, data: { enabled: false } });
      await tx.auditLog.create({ data: { actor: 'admin', action: 'account.deleted', entityType: 'Account', entityId: id, details: { requestedRetainData: retainData, retainedBusinessData, officialRevocationSupported, revocation: officialRevocationSupported ? 'revoked' : 'unsupported' } } });
    });
    return { id, retainedBusinessData, credentialsDeleted: true, officialRevocationSupported };
  }
}
