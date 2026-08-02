import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@xhs/database';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { page } from '../common/pagination.dto';
import { CredentialCipher } from '../security/credential-cipher';

@Injectable()
export class AccountsService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}
  async list(cursor: string | undefined, limit: number) {
    const items = await prisma.account.findMany({ where: cursor ? { id: { gt: cursor } } : undefined, orderBy: { id: 'asc' }, take: limit + 1, include: { capabilities: true } });
    return page(items, limit);
  }
  async authorize(input: { connectorType: string; platformId: string; displayName?: string; secret: string; kind: string }) {
    const account = await prisma.account.upsert({ where: { connectorType_platformId: { connectorType: input.connectorType, platformId: input.platformId } }, create: { connectorType: input.connectorType, platformId: input.platformId, displayName: input.displayName }, update: { displayName: input.displayName } });
    const credentialId = randomUUID();
    const encrypted = new CredentialCipher().encrypt(input.secret, account.id, credentialId);
    await prisma.credential.deleteMany({ where: { accountId: account.id, kind: input.kind } });
    await prisma.credential.create({ data: { id: credentialId, accountId: account.id, kind: input.kind, secret: encrypted } });
    await this.audit.record('account.authorized', 'Account', account.id, { connectorType: input.connectorType });
    return account;
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
    await prisma.credential.deleteMany({ where: { accountId: id, kind } });
    await prisma.credential.create({ data: { id: credentialId, accountId: id, kind, secret: encrypted } });
    await this.audit.record('account.reauthorized', 'Account', id, { kind });
    return account;
  }
  async remove(id: string, retainData: boolean) {
    const account = await prisma.account.findUnique({ where: { id }, include: { capabilities: true } });
    if (!account) throw new NotFoundException('managed account not found');
    const officialRevocationSupported = account.capabilities.some((c) => c.capability === 'revoke' && c.enabled);
    await this.audit.record('account.deleted', 'Account', id, { retainData, officialRevocationSupported });
    await prisma.credential.deleteMany({ where: { accountId: id } });
    if (!retainData) await prisma.account.delete({ where: { id } });
    else await prisma.connectorCapability.updateMany({ where: { accountId: id }, data: { enabled: false } });
    return { id, retainedBusinessData: retainData, credentialsDeleted: true, officialRevocationSupported };
  }
}
