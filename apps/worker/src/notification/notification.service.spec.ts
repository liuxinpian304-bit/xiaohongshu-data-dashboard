import { describe, expect, it } from 'vitest';

import {
  NotificationService,
  type DomainEvent,
  type NotificationRecord,
  type NotificationRepository,
  type PushGateway,
} from './notification.service';

class MemoryNotificationRepository implements NotificationRepository {
  records: NotificationRecord[] = [];

  async createOnce(input: Omit<NotificationRecord, 'id' | 'createdAt' | 'readAt'>) {
    const existing = this.records.find((record) => record.eventId === input.eventId);
    if (existing) return { notification: existing, created: false };
    const notification = { ...input, id: `notification-${this.records.length + 1}`, createdAt: new Date(), readAt: null };
    this.records.push(notification);
    return { notification, created: true };
  }

  async listPushSubscriptions() { return [{ endpoint: 'https://push.example/subscription', p256dh: 'key', auth: 'auth' }]; }
}

const event: DomainEvent = {
  id: 'event-1',
  type: 'sync_completed',
  accountId: 'account-1',
  occurredAt: new Date('2026-08-02T10:00:00Z'),
  data: { syncJobId: 'sync-42' },
};

describe('NotificationService', () => {
  it('creates one notification for repeated delivery of the same event', async () => {
    const repository = new MemoryNotificationRepository();
    const service = new NotificationService(repository);

    await service.publishNotification(event);
    await service.publishNotification(event);

    expect(repository.records).toHaveLength(1);
    expect(repository.records[0]).toMatchObject({ eventId: 'event-1', type: 'sync_completed', link: '/sync-jobs/sync-42' });
  });

  it('keeps the in-app notification when web push delivery fails', async () => {
    const repository = new MemoryNotificationRepository();
    const push: PushGateway = { send: async () => { throw new Error('permission denied'); } };

    await expect(new NotificationService(repository, push).publishNotification(event)).resolves.toMatchObject({ eventId: 'event-1' });
    expect(repository.records).toHaveLength(1);
  });

  it('does not send web push again for a duplicate event delivery', async () => {
    const repository = new MemoryNotificationRepository();
    let deliveries = 0;
    const push: PushGateway = { send: async () => { deliveries += 1; } };
    const service = new NotificationService(repository, push);

    await service.publishNotification(event);
    await service.publishNotification(event);

    expect(deliveries).toBe(1);
  });
});
