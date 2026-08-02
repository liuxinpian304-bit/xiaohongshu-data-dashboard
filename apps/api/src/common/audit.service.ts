import { Injectable } from '@nestjs/common';
import { prisma } from '@xhs/database';

@Injectable()
export class AuditService {
  record(action: string, entityType: string, entityId: string, details?: Record<string, string | boolean | number | null>) {
    return prisma.auditLog.create({ data: { actor: 'admin', action, entityType, entityId, details } });
  }
}
