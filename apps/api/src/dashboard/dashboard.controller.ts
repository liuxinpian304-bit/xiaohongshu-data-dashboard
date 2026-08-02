import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from '../common/api.dto'; import { dtoPipe } from '../common/dto.pipe';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}
  @Get() get(@Query(dtoPipe(DashboardQueryDto)) query: DashboardQueryDto) { return this.dashboard.get(query.period ?? 'daily', query.accountId, query.source ?? 'official'); }
}
