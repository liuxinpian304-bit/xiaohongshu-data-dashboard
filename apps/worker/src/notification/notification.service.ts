import type { DatabaseClient } from '@xhs/database';
import webpush from 'web-push';
import { PushEndpointPolicy } from './push-endpoint.policy';

export const NOTIFICATION_EVENT_TYPES = [
  'sync_completed', 'sync_failed', 'authorization_expired', 'new_comment',
  'comment_sync_incomplete', 'report_generated', 'report_rebuilt',
] as const;

export type NotificationEventType = typeof NOTIFICATION_EVENT_TYPES[number];

export interface DomainEvent {
  id: string;
  type: NotificationEventType;
  accountId: string;
  occurredAt: Date;
  data: Record<string, unknown>;
}

export interface NotificationRecord {
  id: string;
  eventId: string;
  accountId: string;
  type: NotificationEventType;
  title: string;
  body: string;
  link: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface PushSubscriptionRecord { endpoint: string; p256dh: string; auth: string }

export interface NotificationRepository {
  createOnce(input: Omit<NotificationRecord, 'id' | 'createdAt' | 'readAt'>): Promise<{ notification: NotificationRecord; created: boolean }>;
  listPushSubscriptions(accountId: string): Promise<PushSubscriptionRecord[]>;
  deletePushSubscription(accountId: string, endpoint: string): Promise<void>;
}

export type PushDeliveryResult = { outcome: 'delivered'; statusCode?: number } | { outcome: 'gone'; statusCode: 404 | 410 } | { outcome: 'retryable_failure'; statusCode?: number; error: string };
export interface PushGateway {
  send(subscription: PushSubscriptionRecord, notification: NotificationRecord): Promise<PushDeliveryResult>;
}

export class WebPushGateway implements PushGateway {
  constructor(
    private readonly subject = process.env.VAPID_SUBJECT,
    private readonly publicKey = process.env.VAPID_PUBLIC_KEY,
    private readonly privateKey = process.env.VAPID_PRIVATE_KEY,
    private readonly endpointPolicy = new PushEndpointPolicy(),
  ) {}

  async send(subscription: PushSubscriptionRecord, notification: NotificationRecord): Promise<PushDeliveryResult> {
    try {
      await this.endpointPolicy.assertResolvedAllowed(subscription.endpoint);
      if (!this.subject || !this.publicKey || !this.privateKey) throw new Error('Web Push VAPID configuration is missing');
      webpush.setVapidDetails(this.subject, this.publicKey, this.privateKey);
      const response = await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify({ title: notification.title, body: notification.body, link: notification.link }),
      );
      return { outcome: 'delivered', statusCode: response.statusCode };
    } catch (error) {
      const statusCode = pushStatus(error);
      if (statusCode === 404 || statusCode === 410) return { outcome: 'gone', statusCode };
      return { outcome: 'retryable_failure', statusCode, error: error instanceof Error ? error.message : 'push delivery failed' };
    }
  }
}

export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly database: DatabaseClient) {}

  async createOnce(input: Omit<NotificationRecord, 'id' | 'createdAt' | 'readAt'>) {
    try {
      const notification = await this.database.notification.create({ data: input });
      return { notification: asNotificationRecord(notification), created: true };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const notification = await this.database.notification.findUnique({ where: { eventId: input.eventId } });
      if (!notification) throw error;
      return { notification: asNotificationRecord(notification), created: false };
    }
  }

  async listPushSubscriptions(accountId: string) {
    return this.database.pushSubscription.findMany({ where: { accountId }, select: { endpoint: true, p256dh: true, auth: true } });
  }
  async deletePushSubscription(accountId: string, endpoint: string) {
    await this.database.pushSubscription.deleteMany({ where: { accountId, endpoint } });
  }
}

export class NotificationService {
  constructor(private readonly repository: NotificationRepository, private readonly push?: PushGateway) {}

  async publishNotification(event: DomainEvent): Promise<NotificationRecord> {
    if (!event.id) throw new Error('event id is required');
    if (!event.accountId) throw new Error('accountId is required');
    const content = notificationContent(event);
    const result = await this.repository.createOnce({
      eventId: event.id, accountId: event.accountId, type: event.type, ...content,
    });
    if (!result.created || !this.push) return result.notification;

    const subscriptions = await this.repository.listPushSubscriptions(event.accountId).catch(() => []);
    await Promise.allSettled(subscriptions.map(async (subscription) => {
      const delivery = await this.push!.send(subscription, result.notification);
      if (delivery.outcome === 'gone') await this.repository.deletePushSubscription(event.accountId, subscription.endpoint);
    }));
    return result.notification;
  }
}

function value(data: Record<string, unknown>, key: string): string {
  const candidate = data[key];
  if (typeof candidate !== 'string' || candidate.length === 0) throw new Error(`${key} is required for notification event`);
  return encodeURIComponent(candidate);
}

function notificationContent(event: DomainEvent): Pick<NotificationRecord, 'title' | 'body' | 'link'> {
  const syncJobLink = event.type === 'sync_completed' || event.type === 'sync_failed' ? `/sync-jobs/${value(event.data, 'syncJobId')}` : '';
  switch (event.type) {
    case 'sync_completed': return { title: '同步完成', body: '账号数据同步已完成', link: syncJobLink };
    case 'sync_failed': return { title: '同步失败', body: '账号数据同步失败，请查看详情', link: syncJobLink };
    case 'authorization_expired': return { title: '授权已失效', body: '请重新授权账号后继续同步', link: `/accounts/${encodeURIComponent(event.accountId)}/authorization` };
    case 'new_comment': value(event.data, 'commentId'); return { title: '收到新评论', body: '笔记收到一条新评论', link: `/notes/${value(event.data, 'noteId')}/comments` };
    case 'comment_sync_incomplete': return { title: '评论同步不完整', body: '部分评论尚未同步完成', link: `/notes/${value(event.data, 'noteId')}/comments` };
    case 'report_generated': return { title: '报告已生成', body: '新的数据报告已生成', link: `/reports/${value(event.data, 'reportId')}` };
    case 'report_rebuilt': return { title: '报告已更新', body: '补数后的报告已重新生成', link: `/reports/${value(event.data, 'reportId')}` };
  }
}

function pushStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : undefined;
}

function asNotificationRecord(record: {
  id: string; eventId: string; accountId: string; type: string; title: string; body: string;
  link: string; readAt: Date | null; createdAt: Date;
}): NotificationRecord {
  if (!(NOTIFICATION_EVENT_TYPES as readonly string[]).includes(record.type)) throw new Error(`unsupported notification type: ${record.type}`);
  return { ...record, type: record.type as NotificationEventType };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
