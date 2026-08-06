import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { AccountQueryDto } from '../common/api.dto';
import { dtoPipe } from '../common/dto.pipe';
import { pagination } from '../common/pagination.dto';
import { uuid } from '../common/validation';
import { NoteExportService } from './note-export.service';
import { NotesService } from './notes.service';

@Controller('notes') @UseGuards(AuthGuard)
export class NotesController {
  constructor(@Inject(NotesService) private readonly notes: NotesService, @Inject(NoteExportService) private readonly exporter: NoteExportService) {}
  @Get() list(@Query(dtoPipe(AccountQueryDto)) query: AccountQueryDto) { const p = pagination(query); return this.notes.list(query.accountId ? uuid(query.accountId, 'accountId') : undefined, p.cursor, p.limit); }
  @Get('export.zip') async export(@Query(dtoPipe(AccountQueryDto)) query: AccountQueryDto, @Res() response: Response) {
    const zip = await this.exporter.export(query.accountId ? uuid(query.accountId, 'accountId') : undefined);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    response.type('application/zip'); response.setHeader('Content-Disposition', `attachment; filename="xiaohongshu-data-${date}.zip"`); response.send(zip);
  }
  @Get(':id') detail(@Param('id', new ParseUUIDPipe()) id: string) { return this.notes.detail(id); }
}
