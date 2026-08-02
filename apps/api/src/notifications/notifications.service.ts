import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { prisma } from '@xhs/database';

import { parsePushSubscription } from './dto';
import { PushEndpointPolicy } from '@xhs/domain';

export const NOTIFICATIONS_STORE = Symbol('NOTIFICATIONS_STORE');

export interface NotificationsStore {
  list(accountId?: string): Promise<unknown[]>;
  markRead(id: string, readAt: Date): Promise<unknown>;
  notificationAccountId(id: string): Promise<string | null>;
  savePushSubscription(subscription: { accountId: string; endpoint: string; p256dh: string; auth: string }): Promise<unknown>;
  hasManagedAccount(accountId: string): Promise<boolean>;
}

@Injectable()
export class PrismaNotificationsStore implements NotificationsStore {
  list(accountId?: string) {
    return prisma.notification.findMany({ where: accountId ? { accountId } : undefined, orderBy: { createdAt: 'desc' } });
  }
  markRead(id: string, readAt: Date) { return prisma.notification.update({ where: { id }, data: { readAt } }); }
  async notificationAccountId(id: string) { return (await prisma.notification.findUnique({ where: { id }, select: { accountId: true } }))?.accountId ?? null; }
  savePushSubscription(subscription: { accountId: string; endpoint: string; p256dh: string; auth: string }) {
    return prisma.pushSubscription.upsert({
      where: { accountId_endpoint: { accountId: subscription.accountId, endpoint: subscription.endpoint } },
      create: subscription, update: { p256dh: subscription.p256dh, auth: subscription.auth },
    });
  }
  async hasManagedAccount(accountId: string) { return (await prisma.account.count({ where: { id: accountId } })) === 1; }
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(NOTIFICATIONS_STORE) private readonly store: NotificationsStore, private readonly endpointPolicy = new PushEndpointPolicy(), @Optional() private readonly audit?: AuditService) {}
  async list(accountId?: string) {
    if (accountId && !(await this.store.hasManagedAccount(accountId))) throw new NotFoundException('managed account not found');
    return this.store.list(accountId);
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
    const result = await this.store.savePushSubscription({ accountId: subscription.accountId, endpoint: subscription.endpoint, ...subscription.keys });
    await this.audit?.record('notification.push_configured', 'Account', subscription.accountId, { endpointHost: new URL(subscription.endpoint).host });
    return result;
  }
}
