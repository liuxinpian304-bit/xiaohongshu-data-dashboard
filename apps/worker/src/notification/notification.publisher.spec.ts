import { describe, expect, it } from 'vitest';
import { NotificationPublisher } from './notification.publisher';

describe('NotificationPublisher', () => {
  it('does not fail the business task when notification enqueue fails and logs no payload secrets', async () => {
    const logs: unknown[] = [];
    const publisher = new NotificationPublisher({ add: async () => { throw new Error('redis unavailable'); } } as never, (entry) => logs.push(entry));
    await expect(publisher.publish({ id: 'event-1', type: 'sync_completed', accountId: 'account-1', data: { syncJobId: 'job-1' } })).resolves.toBeUndefined();
    expect(logs).toEqual([{ service: 'worker', component: 'notification-publisher', event: 'enqueue_failed', eventId: 'event-1', eventType: 'sync_completed', error: 'redis unavailable' }]);
  });
});
