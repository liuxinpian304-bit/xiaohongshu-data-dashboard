import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { NotificationsService, type NotificationsStore } from './notifications.service';
import { PushEndpointPolicy } from '@xhs/domain';
import { AuditService } from '../common/audit.service';

function memoryStore(): NotificationsStore & { readAt: Date | null; subscriptions: unknown[] } {
  return {
    readAt: null,
    subscriptions: [],
    list: async () => [{ id: '00000000-0000-4000-8000-000000000001', readAt: null }],
    markRead: async function (id, readAt) { this.readAt = readAt; return { id, readAt }; },
    notificationAccountId: async () => 'account-1',
    savePushSubscription: async function (subscription, beforeCommit) { await beforeCommit?.(); this.subscriptions.push(subscription); return { id: 'subscription-1', ...subscription }; },
    hasManagedAccount: async () => true,
  };
}
const audit = { record: async () => ({}) } as unknown as AuditService;

describe('NotificationsService', () => {
  it('persists a notification read timestamp', async () => {
    const store = memoryStore();
    const result = await new NotificationsService(store, new PushEndpointPolicy(['push.example'], publicResolver), audit).markRead('notification-1');
    expect(store.readAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({ id: 'notification-1', readAt: store.readAt });
  });
  it('returns notifications in the common cursor-page envelope', async () => {
    const result = await new NotificationsService(memoryStore(), new PushEndpointPolicy(['push.example'], publicResolver), audit).list(undefined, undefined, 1);
    expect(result).toEqual({ items: [{ id: '00000000-0000-4000-8000-000000000001', readAt: null }], pageInfo: { nextCursor: null, hasMore: false } });
  });

  it('rejects a push subscription without an auth secret', async () => {
    const store = memoryStore();
    await expect(new NotificationsService(store, new PushEndpointPolicy(['push.example'], publicResolver), audit).subscribe({
      accountId: 'account-1', endpoint: 'https://push.example/subscription', keys: { p256dh: 'public-key' },
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(store.subscriptions).toHaveLength(0);
  });

  it('stores a valid push subscription in normalized form', async () => {
    const store = memoryStore();
    const response = await new NotificationsService(store, new PushEndpointPolicy(['push.example'], publicResolver), audit).subscribe({
      accountId: 'account-1', endpoint: 'https://push.example/subscription', keys: { p256dh: 'public-key', auth: 'auth-secret' },
    });
    expect(store.subscriptions).toEqual([{
      accountId: 'account-1', endpoint: 'https://push.example/subscription', p256dh: 'public-key', auth: 'auth-secret',
    }]);
    expect(response).toEqual({ id: 'subscription-1', accountId: 'account-1', endpoint: 'https://push.example/subscription' });
  });

  it('rejects a malformed HTTPS endpoint', async () => {
    await expect(new NotificationsService(memoryStore(), new PushEndpointPolicy(['push.example'], publicResolver), audit).subscribe({
      accountId: 'account-1', endpoint: 'https://', keys: { p256dh: 'public-key', auth: 'auth-secret' },
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not retain notification configuration when its audit fails', async () => {
    const store = memoryStore();
    const failingAudit = { record: async () => { throw new Error('audit unavailable'); } } as AuditService;
    await expect(new NotificationsService(store, new PushEndpointPolicy(['push.example'], publicResolver), failingAudit).subscribe({
      accountId: 'account-1', endpoint: 'https://push.example/subscription', keys: { p256dh: 'public-key', auth: 'auth-secret' },
    })).rejects.toThrow('audit unavailable');
    expect(store.subscriptions).toHaveLength(0);
  });
});

const publicResolver = async () => ['8.8.8.8'];
