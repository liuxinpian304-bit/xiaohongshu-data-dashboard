import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { SettingsService } from './settings.service';

@Controller('settings') @UseGuards(AuthGuard)
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}
  @Get('status') status() { return this.settings.status(); }
}
