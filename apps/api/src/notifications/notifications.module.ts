import { Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NOTIFICATIONS_STORE, NotificationsService, PrismaNotificationsStore } from './notifications.service';
import { ADMIN_API_TOKEN, AdminGuard } from './admin.guard';

@Module({ controllers: [NotificationsController], providers: [
  NotificationsService, PrismaNotificationsStore, AdminGuard,
  { provide: ADMIN_API_TOKEN, useValue: process.env.ADMIN_API_TOKEN },
  { provide: NOTIFICATIONS_STORE, useExisting: PrismaNotificationsStore },
] })
export class NotificationsModule {}
