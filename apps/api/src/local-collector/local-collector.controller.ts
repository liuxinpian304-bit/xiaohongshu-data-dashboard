import { Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { LocalCollectorService, type CollectorAction } from './local-collector.service';

@Controller('local-collector') @UseGuards(AuthGuard)
export class LocalCollectorController {
  constructor(@Inject(LocalCollectorService) private readonly collector: LocalCollectorService) {}
  @Get('status') status() { return this.collector.action('status'); }
  @Post(':action') action(@Param('action') action: CollectorAction) { return this.collector.action(action); }
}
