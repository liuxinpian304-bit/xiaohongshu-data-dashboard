import { Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NOTIFICATIONS_STORE, NotificationsService, PrismaNotificationsStore } from './notifications.service';
import { AuditService } from '../common/audit.service';
import { PushEndpointPolicy } from '@xhs/domain';

@Module({ controllers: [NotificationsController], providers: [
  NotificationsService, PrismaNotificationsStore, AuditService, PushEndpointPolicy,
  { provide: NOTIFICATIONS_STORE, useExisting: PrismaNotificationsStore },
] })
export class NotificationsModule {}
