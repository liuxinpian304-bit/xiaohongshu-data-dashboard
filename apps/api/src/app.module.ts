import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { NotificationsModule } from './notifications/notifications.module';
import { AuthModule } from './auth/auth.module';
import { AccountsModule } from './accounts/accounts.module';
import { JobsModule } from './jobs/jobs.module';
import { NotesModule } from './notes/notes.module';
import { CommentsModule } from './comments/comments.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';
import { LocalCollectorModule } from './local-collector/local-collector.module';
import { SettingsModule } from './settings/settings.module';
import { DouyinLocalModule } from './douyin-local/douyin-local.module';

@Module({
  imports: [AuthModule, AccountsModule, JobsModule, NotesModule, CommentsModule, DashboardModule, ReportsModule, NotificationsModule, LocalCollectorModule, DouyinLocalModule, SettingsModule],
  controllers: [HealthController],
})
export class AppModule {}
