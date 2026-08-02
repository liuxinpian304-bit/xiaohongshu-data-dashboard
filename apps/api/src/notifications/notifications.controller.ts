import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard'; import { dtoPipe } from '../common/dto.pipe'; import { NotificationQueryDto, PushSubscriptionRequestDto } from '../common/api.dto'; import { NotificationsService } from './notifications.service';
import { pagination } from '../common/pagination.dto';
@Controller('notifications') @UseGuards(AuthGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}
  @Get() list(@Query(dtoPipe(NotificationQueryDto)) query: NotificationQueryDto) { const { cursor, limit } = pagination(query); return this.notifications.list(query.accountId, cursor, limit); }
  @Patch(':id/read') markRead(@Param('id', new ParseUUIDPipe()) id: string) { return this.notifications.markRead(id); }
  @Post('push-subscriptions') subscribe(@Body(dtoPipe(PushSubscriptionRequestDto)) body: PushSubscriptionRequestDto) { return this.notifications.subscribe(body); }
}
