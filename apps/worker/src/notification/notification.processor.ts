import { Worker, type Job } from 'bullmq';

import { redisConnection } from '../queues';
import type { DomainEvent, NotificationRecord, NotificationService } from './notification.service';

export const NOTIFICATION_QUEUE = 'notifications';
export interface NotificationJobData { event: DomainEvent }

export function processNotificationJob(service: NotificationService, job: Job<NotificationJobData>): Promise<NotificationRecord> {
  const event = { ...job.data.event, occurredAt: new Date(job.data.event.occurredAt) };
  return service.publishNotification(event);
}

export function createNotificationWorker(service: NotificationService) {
  return new Worker<NotificationJobData>(
    NOTIFICATION_QUEUE,
    (job) => processNotificationJob(service, job),
    { connection: redisConnection(), concurrency: Number(process.env.NOTIFICATION_CONCURRENCY ?? 4) },
  );
}
