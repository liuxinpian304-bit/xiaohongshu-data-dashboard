import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard'; import { pagination } from '../common/pagination.dto'; import { object, stringField, uuid } from '../common/validation'; import { JobsService } from './jobs.service';
import { CreateJobDto, PaginationQueryDto } from '../common/api.dto'; import { dtoPipe } from '../common/dto.pipe';
@Controller('jobs') @UseGuards(AuthGuard)
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}
  @Get() list(@Query(dtoPipe(PaginationQueryDto)) query: PaginationQueryDto) { const p = pagination(query); return this.jobs.list(p.cursor, p.limit); }
  @Post() @HttpCode(202) create(@Body(dtoPipe(CreateJobDto)) value: CreateJobDto) { const body = object(value); return this.jobs.create(uuid(stringField(body, 'accountId')!, 'accountId')); }
  @Post(':id/cancel') cancel(@Param('id', new ParseUUIDPipe()) id: string) { return this.jobs.cancel(id); }
}
