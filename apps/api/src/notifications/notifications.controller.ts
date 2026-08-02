import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(AdminGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Query('accountId') accountId?: string) { return this.notifications.list(accountId); }

  @Patch(':id/read')
  markRead(@Param('id') id: string) { return this.notifications.markRead(id); }

  @Post('push-subscriptions')
  subscribe(@Body() body: unknown) { return this.notifications.subscribe(body); }
}
