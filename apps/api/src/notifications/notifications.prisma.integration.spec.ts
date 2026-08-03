import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@xhs/database';
import { NotFoundException } from '@nestjs/common';

import { NotificationsService, PrismaNotificationsStore } from './notifications.service';
import { PushEndpointPolicy } from '@xhs/domain';
import { AuditService } from '../common/audit.service';

describe('Prisma notifications API store', () => {
  const service = new NotificationsService(new PrismaNotificationsStore(), new PushEndpointPolicy(['push.example.test'], async () => ['8.8.8.8']), new AuditService());
  beforeEach(async () => { await prisma.pushSubscription.deleteMany(); await prisma.notification.deleteMany(); await prisma.auditLog.deleteMany(); await prisma.account.deleteMany({ where: { notes: { none: {} }, reports: { none: {} } } }); });
  afterAll(async () => prisma.$disconnect());

  it('lists all managed-account notifications and persists read state', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'api-notification', platformId: crypto.randomUUID() } });
    const notification = await prisma.notification.create({ data: { eventId: crypto.randomUUID(), accountId: account.id, type: 'sync_completed', title: '完成', body: '已完成', link: '/sync-jobs/job-1' } });
    expect((await service.list()).items).toHaveLength(1);
    await service.markRead(notification.id);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt).toBeInstanceOf(Date);
  });

  it('stores a subscription only for an existing managed account', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'api-subscription', platformId: crypto.randomUUID() } });
    const response = await service.subscribe({ accountId: account.id, endpoint: 'https://push.example.test/sub', keys: { p256dh: 'key', auth: 'auth' } });
    expect(response).toEqual(expect.objectContaining({ accountId: account.id, endpoint: 'https://push.example.test/sub' }));
    expect(response).not.toHaveProperty('p256dh'); expect(response).not.toHaveProperty('auth');
    expect(await prisma.pushSubscription.count({ where: { accountId: account.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: account.id, action: 'notification.push_configured' } })).toBe(1);
    await expect(service.subscribe({ accountId: crypto.randomUUID(), endpoint: 'https://push.example.test/sub', keys: { p256dh: 'key', auth: 'auth' } })).rejects.toBeInstanceOf(NotFoundException);
  });
});
