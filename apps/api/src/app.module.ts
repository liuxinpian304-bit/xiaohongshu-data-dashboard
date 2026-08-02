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

@Module({
  imports: [AuthModule, AccountsModule, JobsModule, NotesModule, CommentsModule, DashboardModule, ReportsModule, NotificationsModule],
  controllers: [HealthController],
})
export class AppModule {}
