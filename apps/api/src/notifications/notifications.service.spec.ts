import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { NotificationsService, type NotificationsStore } from './notifications.service';

function memoryStore(): NotificationsStore & { readAt: Date | null; subscriptions: unknown[] } {
  return {
    readAt: null,
    subscriptions: [],
    list: async () => [{ id: 'notification-1', readAt: null }],
    markRead: async function (id, readAt) { this.readAt = readAt; return { id, readAt }; },
    savePushSubscription: async function (subscription) { this.subscriptions.push(subscription); return { id: 'subscription-1' }; },
  };
}

describe('NotificationsService', () => {
  it('persists a notification read timestamp', async () => {
    const store = memoryStore();
    const result = await new NotificationsService(store).markRead('notification-1');
    expect(store.readAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({ id: 'notification-1', readAt: store.readAt });
  });

  it('rejects a push subscription without an auth secret', async () => {
    const store = memoryStore();
    await expect(new NotificationsService(store).subscribe({
      accountId: 'account-1', endpoint: 'https://push.example/subscription', keys: { p256dh: 'public-key' },
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(store.subscriptions).toHaveLength(0);
  });

  it('stores a valid push subscription in normalized form', async () => {
    const store = memoryStore();
    await new NotificationsService(store).subscribe({
      accountId: 'account-1', endpoint: 'https://push.example/subscription', keys: { p256dh: 'public-key', auth: 'auth-secret' },
    });
    expect(store.subscriptions).toEqual([{
      accountId: 'account-1', endpoint: 'https://push.example/subscription', p256dh: 'public-key', auth: 'auth-secret',
    }]);
  });

  it('rejects a malformed HTTPS endpoint', async () => {
    await expect(new NotificationsService(memoryStore()).subscribe({
      accountId: 'account-1', endpoint: 'https://', keys: { p256dh: 'public-key', auth: 'auth-secret' },
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});
