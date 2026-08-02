import { MockXhsConnector } from '@xhs/connector';
import { prisma } from '@xhs/database';

import { createSyncWorker } from './sync/sync.processor';
import { SyncRepository } from './sync/sync.repository';
import { SyncService } from './sync/sync.service';

export function startWorker() {
  const service = new SyncService(new MockXhsConnector(), new SyncRepository(prisma));
  return createSyncWorker(service);
}
