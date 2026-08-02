import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { TransactionClient } from '@xhs/database';
import { AuditService } from '../common/audit.service';
import { prisma } from '@xhs/database';

import { parsePushSubscription } from './dto';
import { PushEndpointPolicy } from '@xhs/domain';
import { page } from '../common/pagination.dto';

export const NOTIFICATIONS_STORE = Symbol('NOTIFICATIONS_STORE');

export interface NotificationsStore {
  list(accountId?: string, cursor?: string, limit?: number): Promise<Array<{ id: string }>>;
  markRead(id: string, readAt: Date): Promise<unknown>;
  notificationAccountId(id: string): Promise<string | null>;
  savePushSubscription(subscription: { accountId: string; endpoint: string; p256dh: string; auth: string }, beforeCommit?: (tx?: TransactionClient) => Promise<unknown>): Promise<{ id: string; accountId: string; endpoint: string; p256dh?: string; auth?: string }>;
  hasManagedAccount(accountId: string): Promise<boolean>;
}

@Injectable()
export class PrismaNotificationsStore implements NotificationsStore {
  list(accountId?: string, cursor?: string, limit = 50) {
    return prisma.notification.findMany({ where: { ...(accountId ? { accountId } : {}), ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: limit + 1 });
  }
  markRead(id: string, readAt: Date) { return prisma.notification.update({ where: { id }, data: { readAt } }); }
  async notificationAccountId(id: string) { return (await prisma.notification.findUnique({ where: { id }, select: { accountId: true } }))?.accountId ?? null; }
  savePushSubscription(subscription: { accountId: string; endpoint: string; p256dh: string; auth: string }, beforeCommit?: (tx?: TransactionClient) => Promise<unknown>) {
    return prisma.$transaction(async (tx) => {
      await beforeCommit?.(tx);
      return tx.pushSubscription.upsert({
        where: { accountId_endpoint: { accountId: subscription.accountId, endpoint: subscription.endpoint } },
        create: subscription, update: { p256dh: subscription.p256dh, auth: subscription.auth },
        select: { id: true, accountId: true, endpoint: true },
      });
    });
  }
  async hasManagedAccount(accountId: string) { return (await prisma.account.count({ where: { id: accountId } })) === 1; }
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(NOTIFICATIONS_STORE) private readonly store: NotificationsStore, @Inject(PushEndpointPolicy) private readonly endpointPolicy: PushEndpointPolicy, @Inject(AuditService) private readonly audit: AuditService) {}
  async list(accountId?: string, cursor?: string, limit = 50) {
    if (accountId && !(await this.store.hasManagedAccount(accountId))) throw new NotFoundException('managed account not found');
    return page(await this.store.list(accountId, cursor, limit), limit);
  }
  async markRead(id: string) {
    const accountId = await this.store.notificationAccountId(id);
    if (!accountId || !(await this.store.hasManagedAccount(accountId))) throw new NotFoundException('managed notification not found');
    return this.store.markRead(id, new Date());
  }
  async subscribe(input: unknown) {
    let subscription;
    try {
      subscription = parsePushSubscription(input, this.endpointPolicy);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'invalid push subscription');
    }
    try { await this.endpointPolicy.resolveAndPin(subscription.endpoint); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'invalid push destination'); }
    if (!(await this.store.hasManagedAccount(subscription.accountId))) throw new NotFoundException('managed account not found');
    const saved = await this.store.savePushSubscription(
      { accountId: subscription.accountId, endpoint: subscription.endpoint, ...subscription.keys },
      (tx) => this.audit.record('notification.push_configured', 'Account', subscription.accountId, { endpointHost: new URL(subscription.endpoint).host }, tx),
    );
    return { id: saved.id, accountId: saved.accountId, endpoint: saved.endpoint };
  }
}
