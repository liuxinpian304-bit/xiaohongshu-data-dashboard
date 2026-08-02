import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard'; import { pagination } from '../common/pagination.dto'; import { object, stringField, uuid } from '../common/validation'; import { JobsService } from './jobs.service';
import type { CreateJobDto, PaginationQueryDto } from '../common/api.dto';
@Controller('jobs') @UseGuards(AuthGuard)
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}
  @Get() list(@Query() query: PaginationQueryDto) { const p = pagination(query); return this.jobs.list(p.cursor, p.limit); }
  @Post() @HttpCode(202) create(@Body() value: CreateJobDto) { const body = object(value); return this.jobs.create(uuid(stringField(body, 'accountId')!, 'accountId')); }
  @Post(':id/cancel') cancel(@Param('id') id: string) { return this.jobs.cancel(uuid(id)); }
}
