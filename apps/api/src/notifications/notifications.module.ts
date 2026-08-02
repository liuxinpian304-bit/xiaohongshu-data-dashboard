import { Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NOTIFICATIONS_STORE, NotificationsService, PrismaNotificationsStore } from './notifications.service';
import { AuditService } from '../common/audit.service';

@Module({ controllers: [NotificationsController], providers: [
  NotificationsService, PrismaNotificationsStore, AuditService,
  { provide: NOTIFICATIONS_STORE, useExisting: PrismaNotificationsStore },
] })
export class NotificationsModule {}
