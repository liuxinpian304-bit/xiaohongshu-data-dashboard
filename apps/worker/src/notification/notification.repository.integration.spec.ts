import { afterAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '@xhs/database';

import { PrismaNotificationRepository, type DomainEvent, NotificationService } from './notification.service';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/xhs_dashboard';
const firstDb = createDatabaseClient(connectionString);
const secondDb = createDatabaseClient(connectionString);

describe('PrismaNotificationRepository', () => {
  afterAll(async () => Promise.all([firstDb.$disconnect(), secondDb.$disconnect()]));

  it('keeps one fact when two workers concurrently deliver the same event', async () => {
    const account = await firstDb.account.create({ data: { connectorType: 'notification-integration', platformId: crypto.randomUUID() } });
    const event: DomainEvent = {
      id: crypto.randomUUID(), type: 'sync_completed', accountId: account.id,
      occurredAt: new Date(), data: { syncJobId: 'concurrent-sync' },
    };

    const [first, second] = await Promise.all([
      new NotificationService(new PrismaNotificationRepository(firstDb)).publishNotification(event),
      new NotificationService(new PrismaNotificationRepository(secondDb)).publishNotification(event),
    ]);

    expect(first.id).toBe(second.id);
    expect(await firstDb.notification.count({ where: { eventId: event.id } })).toBe(1);
    await firstDb.account.deleteMany({ where: { id: account.id } });
  });
});
