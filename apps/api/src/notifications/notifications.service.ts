import { BadRequestException, Injectable } from '@nestjs/common';
import { prisma } from '@xhs/database';

import { parsePushSubscription } from './dto';

export interface NotificationsStore {
  list(accountId?: string): Promise<unknown[]>;
  markRead(id: string, readAt: Date): Promise<unknown>;
  savePushSubscription(subscription: { accountId: string; endpoint: string; p256dh: string; auth: string }): Promise<unknown>;
}

export class PrismaNotificationsStore implements NotificationsStore {
  list(accountId?: string) {
    return prisma.notification.findMany({ where: accountId ? { accountId } : undefined, orderBy: { createdAt: 'desc' } });
  }
  markRead(id: string, readAt: Date) { return prisma.notification.update({ where: { id }, data: { readAt } }); }
  savePushSubscription(subscription: { accountId: string; endpoint: string; p256dh: string; auth: string }) {
    return prisma.pushSubscription.upsert({
      where: { accountId_endpoint: { accountId: subscription.accountId, endpoint: subscription.endpoint } },
      create: subscription, update: { p256dh: subscription.p256dh, auth: subscription.auth },
    });
  }
}

@Injectable()
export class NotificationsService {
  constructor(private readonly store: NotificationsStore = new PrismaNotificationsStore()) {}
  list(accountId?: string) { return this.store.list(accountId); }
  markRead(id: string) { return this.store.markRead(id, new Date()); }
  async subscribe(input: unknown) {
    let subscription;
    try {
      subscription = parsePushSubscription(input);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'invalid push subscription');
    }
    return await this.store.savePushSubscription({ accountId: subscription.accountId, endpoint: subscription.endpoint, ...subscription.keys });
  }
}
