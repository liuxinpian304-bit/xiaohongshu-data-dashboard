import type { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import type { DomainEvent } from './notification.service';
import type { NotificationJobData } from './notification.processor';

export type PublishableNotificationEvent = Omit<DomainEvent, 'occurredAt'>;
export interface NotificationEventPublisher { publish(event: PublishableNotificationEvent): Promise<void> }

export class NotificationPublisher implements NotificationEventPublisher {
  constructor(private readonly queue: Pick<Queue<NotificationJobData>, 'add'>, private readonly logError: (entry: unknown) => void = (entry) => console.error(JSON.stringify(entry))) {}
  async publish(event: PublishableNotificationEvent) {
    try {
      const jobId = `notification-${createHash('sha256').update(event.id).digest('hex')}`;
      await this.queue.add(event.type, { event: { ...event, occurredAt: new Date() } }, { jobId, removeOnComplete: { age: 7 * 24 * 60 * 60 }, attempts: 3 });
    } catch (error) {
      this.logError({ service: 'worker', component: 'notification-publisher', event: 'enqueue_failed', eventId: event.id, eventType: event.type, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
