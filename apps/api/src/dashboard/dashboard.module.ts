import { Module } from '@nestjs/common';

import { DashboardController } from './dashboard.controller';
import { DASHBOARD_STORE, DashboardService, PrismaDashboardStore } from './dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [
    DashboardService,
    PrismaDashboardStore,
    { provide: DASHBOARD_STORE, useExisting: PrismaDashboardStore },
  ],
})
export class DashboardModule {}
