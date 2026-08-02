import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { DashboardService } from './dashboard.service';
import type { DashboardQueryDto } from '../common/api.dto';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}
  @Get() get(@Query() query: DashboardQueryDto) { return this.dashboard.get(query.period ?? 'daily'); }
}
