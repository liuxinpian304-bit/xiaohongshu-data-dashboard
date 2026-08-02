import { Injectable } from '@nestjs/common';
import { prisma } from '@xhs/database';
import type { DatabaseClient, TransactionClient } from '@xhs/database';

@Injectable()
export class AuditService {
  record(action: string, entityType: string, entityId: string, details?: Record<string, string | boolean | number | null>, client: DatabaseClient | TransactionClient = prisma) {
    return client.auditLog.create({ data: { actor: 'admin', action, entityType, entityId, details } });
  }
}
