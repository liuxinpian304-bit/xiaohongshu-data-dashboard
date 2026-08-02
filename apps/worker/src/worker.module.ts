import { MockXhsConnector } from '@xhs/connector';
import { prisma } from '@xhs/database';

import { createSyncWorker } from './sync/sync.processor';
import { createReportQueue, createReportWorker } from './report/report.processor';
import { PrismaAffectedReportStore, ReportRebuildDispatcher, startReportScheduler } from './report/report.scheduler';
import { PrismaReportStore, ReportService } from './report/report.service';
import { SyncRepository } from './sync/sync.repository';
import { SyncService } from './sync/sync.service';

export function startWorker() {
  const reportQueue = createReportQueue();
  const rebuildDispatcher = new ReportRebuildDispatcher(new PrismaAffectedReportStore(prisma), reportQueue);
  const service = new SyncService(new MockXhsConnector(), new SyncRepository(prisma, (event) => rebuildDispatcher.handle(event)));
  const syncWorker = createSyncWorker(service);
  const reportWorker = createReportWorker(new ReportService(new PrismaReportStore(prisma)));
  const scheduler = startReportScheduler(reportQueue, rebuildDispatcher);
  const closeSyncWorker = syncWorker.close.bind(syncWorker);
  syncWorker.close = async (force?: boolean) => {
    await scheduler.close();
    await Promise.all([reportWorker.close(force), reportQueue.close()]);
    await closeSyncWorker(force);
  };
  return syncWorker;
}
