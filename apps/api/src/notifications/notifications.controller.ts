import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';

import { NotificationsService } from './notifications.service';
import type { PushSubscriptionDto } from './dto';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Query('accountId') accountId?: string) { return this.notifications.list(accountId); }

  @Patch(':id/read')
  markRead(@Param('id') id: string) { return this.notifications.markRead(id); }

  @Post('push-subscriptions')
  subscribe(@Body() body: PushSubscriptionDto) { return this.notifications.subscribe(body); }
}
