import { describe, expect, it } from 'vitest';

import {
  NotificationService,
  type DomainEvent,
  type NotificationRecord,
  type NotificationRepository,
  type PushGateway,
} from './notification.service';
import { PushEndpointPolicy } from '@xhs/domain';

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
  deleted: Array<{ accountId: string; endpoint: string }> = [];
  async deletePushSubscription(accountId: string, endpoint: string) { this.deleted.push({ accountId, endpoint }); }
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
    const push: PushGateway = { send: async () => ({ outcome: 'retryable_failure', error: 'permission denied' }) };

    await expect(new NotificationService(repository, push).publishNotification(event)).resolves.toMatchObject({ eventId: 'event-1' });
    expect(repository.records).toHaveLength(1);
  });

  it('does not send web push again for a duplicate event delivery', async () => {
    const repository = new MemoryNotificationRepository();
    let deliveries = 0;
    const push: PushGateway = { send: async () => { deliveries += 1; return { outcome: 'delivered' }; } };
    const service = new NotificationService(repository, push);

    await service.publishNotification(event);
    await service.publishNotification(event);

    expect(deliveries).toBe(1);
  });

  it('deletes only the scoped subscription after a permanent push rejection', async () => {
    const repository = new MemoryNotificationRepository();
    const push: PushGateway = { send: async () => ({ outcome: 'gone', statusCode: 410 }) };
    await new NotificationService(repository, push).publishNotification(event);
    expect(repository.deleted).toEqual([{ accountId: 'account-1', endpoint: 'https://push.example/subscription' }]);
  });

  it('keeps a subscription after a retryable push failure', async () => {
    const repository = new MemoryNotificationRepository();
    const push: PushGateway = { send: async () => ({ outcome: 'retryable_failure', statusCode: 503, error: 'unavailable' }) };
    await expect(new NotificationService(repository, push).publishNotification(event)).resolves.toBeDefined();
    expect(repository.deleted).toEqual([]);
  });

  it('requires event target ids and encodes route path segments', async () => {
    const repository = new MemoryNotificationRepository();
    await expect(new NotificationService(repository).publishNotification({ ...event, type: 'new_comment', data: { commentId: 'comment-1' } })).rejects.toThrow('noteId');
    await new NotificationService(repository).publishNotification({ ...event, id: 'event-malicious', type: 'new_comment', data: { noteId: '../reports?admin=true', commentId: 'comment-1' } });
    expect(repository.records[0]?.link).toBe('/notes/..%2Freports%3Fadmin%3Dtrue/comments');
  });

  it('rejects an event without its identity or managed account id', async () => {
    const service = new NotificationService(new MemoryNotificationRepository());
    await expect(service.publishNotification({ ...event, id: '' })).rejects.toThrow('event id');
    await expect(service.publishNotification({ ...event, accountId: '' })).rejects.toThrow('accountId');
  });

  it('rejects unsafe push endpoints using an explicit host allowlist', () => {
    const policy = new PushEndpointPolicy(['push.example.test']);
    expect(() => policy.assertAllowed('https://push.example.test/subscription')).not.toThrow();
    for (const endpoint of ['https://localhost/push', 'https://127.0.0.1/push', 'https://[::1]/push', 'https://169.254.1.1/push', 'https://user:pass@push.example.test/push', 'https://push.example.test:444/push', 'https://evil.test/push']) {
      expect(() => policy.assertAllowed(endpoint)).toThrow();
    }
  });

  it('rejects an allowlisted hostname that resolves to a private destination', async () => {
    const policy = new PushEndpointPolicy(['push.example.test'], async () => ['127.0.0.1']);
    await expect(policy.resolveAndPin('https://push.example.test/subscription')).rejects.toThrow('public');
  });
});
