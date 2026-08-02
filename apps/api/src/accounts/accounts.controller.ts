import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { pagination } from '../common/pagination.dto';
import { booleanField, object, stringField } from '../common/validation';
import { AccountsService } from './accounts.service';
import { AuthorizeAccountDto, DeleteAccountDto, PaginationQueryDto, ReauthorizeAccountDto } from '../common/api.dto';
import { dtoPipe } from '../common/dto.pipe';

@Controller('accounts') @UseGuards(AuthGuard)
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}
  @Get() list(@Query(dtoPipe(PaginationQueryDto)) query: PaginationQueryDto) { const p = pagination(query); return this.accounts.list(p.cursor, p.limit); }
  @Get('authorized-official') authorizedOfficial(@Query(dtoPipe(PaginationQueryDto)) query: PaginationQueryDto) { const p = pagination(query); return this.accounts.listAuthorizedOfficial(p.cursor, p.limit); }
  @Post('authorize') authorize(@Body(dtoPipe(AuthorizeAccountDto)) value: AuthorizeAccountDto) { const body = object(value); return this.accounts.authorize({ connectorType: stringField(body, 'connectorType', { max: 50 })!, platformId: stringField(body, 'platformId', { max: 200 })!, displayName: stringField(body, 'displayName', { optional: true, max: 200 }), secret: stringField(body, 'secret', { max: 10_000 })!, kind: stringField(body, 'kind', { max: 50 })! }); }
  @Post(':id/reauthorize') reauthorize(@Param('id', new ParseUUIDPipe()) id: string, @Body(dtoPipe(ReauthorizeAccountDto)) value: ReauthorizeAccountDto) { const body = object(value); return this.accounts.reauthorize(id, stringField(body, 'secret', { max: 10_000 })!, stringField(body, 'kind', { max: 50 })!); }
  @Patch(':id/deactivate') deactivate(@Param('id', new ParseUUIDPipe()) id: string) { return this.accounts.deactivate(id); }
  @Delete(':id') remove(@Param('id', new ParseUUIDPipe()) id: string, @Body(dtoPipe(DeleteAccountDto)) value: DeleteAccountDto = {}) { const body = object(value); return this.accounts.remove(id, booleanField(body, 'retainData', true)); }
}
