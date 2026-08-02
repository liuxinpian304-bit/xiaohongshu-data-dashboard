import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { pagination } from '../common/pagination.dto';
import { booleanField, object, stringField, uuid } from '../common/validation';
import { AccountsService } from './accounts.service';

@Controller('accounts') @UseGuards(AuthGuard)
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}
  @Get() list(@Query() query: { cursor?: string; limit?: string }) { const p = pagination(query); return this.accounts.list(p.cursor, p.limit); }
  @Post('authorize') authorize(@Body() value: unknown) { const body = object(value); return this.accounts.authorize({ connectorType: stringField(body, 'connectorType', { max: 50 })!, platformId: stringField(body, 'platformId', { max: 200 })!, displayName: stringField(body, 'displayName', { optional: true, max: 200 }), secret: stringField(body, 'secret', { max: 10_000 })!, kind: stringField(body, 'kind', { max: 50 })! }); }
  @Post(':id/reauthorize') reauthorize(@Param('id') id: string, @Body() value: unknown) { const body = object(value); return this.accounts.reauthorize(uuid(id), stringField(body, 'secret', { max: 10_000 })!, stringField(body, 'kind', { max: 50 })!); }
  @Patch(':id/deactivate') deactivate(@Param('id') id: string) { return this.accounts.deactivate(uuid(id)); }
  @Delete(':id') remove(@Param('id') id: string, @Body() value: unknown = {}) { const body = object(value); return this.accounts.remove(uuid(id), booleanField(body, 'retainData', true)); }
}
