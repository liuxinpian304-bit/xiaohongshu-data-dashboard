import { MockXhsConnector } from '@xhs/connector';
import { prisma } from '@xhs/database';

import { createSyncWorker } from './sync/sync.processor';
import { createNotificationQueue, createNotificationWorker } from './notification/notification.processor';
import { NotificationService, PrismaNotificationRepository, WebPushGateway } from './notification/notification.service';
import { NotificationPublisher } from './notification/notification.publisher';
import { createReportQueue, createReportWorker } from './report/report.processor';
import { PrismaAffectedReportStore, ReportRebuildDispatcher, startReportScheduler } from './report/report.scheduler';
import { PrismaReportStore, ReportService } from './report/report.service';
import { SyncRepository } from './sync/sync.repository';
import { SyncService } from './sync/sync.service';
import { createSyncAccountQueue } from './queues';
import { PrismaPendingSyncStore, startPendingSyncDispatcher } from './sync/pending-sync.dispatcher';

export function startWorker() {
  const syncQueue = createSyncAccountQueue();
  const reportQueue = createReportQueue();
  const notificationQueue = createNotificationQueue();
  const notificationPublisher = new NotificationPublisher(notificationQueue);
  const rebuildDispatcher = new ReportRebuildDispatcher(new PrismaAffectedReportStore(prisma), reportQueue);
  const service = new SyncService(new MockXhsConnector(), new SyncRepository(prisma, () => rebuildDispatcher.dispatchPending()), notificationPublisher);
  const syncWorker = createSyncWorker(service);
  const pendingSyncDispatcher = startPendingSyncDispatcher(new PrismaPendingSyncStore(prisma), syncQueue);
  const notificationWorker = createNotificationWorker(new NotificationService(new PrismaNotificationRepository(prisma), new WebPushGateway()));
  const reportWorker = createReportWorker(new ReportService(new PrismaReportStore(prisma)), notificationPublisher);
  const scheduler = startReportScheduler(reportQueue, rebuildDispatcher);
  const closeSyncWorker = syncWorker.close.bind(syncWorker);
  syncWorker.close = async (force?: boolean) => {
    pendingSyncDispatcher.close();
    await scheduler.close();
    await Promise.all([syncQueue.close(), notificationWorker.close(force), notificationQueue.close(), reportWorker.close(force), reportQueue.close()]);
    await closeSyncWorker(force);
  };
  return syncWorker;
}
