import { BadRequestException, Controller, Get, Inject, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { pagination } from '../common/pagination.dto';
import { strictDate, uuid } from '../common/validation';
import { CommentsService, type CommentFilter } from './comments.service';
import { CommentQueryDto } from '../common/api.dto'; import { dtoPipe } from '../common/dto.pipe';

@Controller('comments') @UseGuards(AuthGuard)
export class CommentsController {
  constructor(@Inject(CommentsService) private readonly comments: CommentsService) {}
  private filter(query: CommentQueryDto): CommentFilter {
    const from = query.from ? strictDate(query.from, 'from') : undefined; const to = query.to ? strictDate(query.to, 'to') : undefined;
    if (from && to && from > to) throw new BadRequestException('from must not be after to');
    return { accountId: query.accountId ? uuid(query.accountId, 'accountId') : undefined, accountIds: query.accountIds, noteId: query.noteId ? uuid(query.noteId, 'noteId') : undefined, from, to };
  }
  @Get() list(@Query(dtoPipe(CommentQueryDto)) query: CommentQueryDto) { const p = pagination(query); return this.comments.list(this.filter(query), p.cursor, p.limit); }
  @Get('export.csv') async export(@Query(dtoPipe(CommentQueryDto)) query: CommentQueryDto, @Res() response: Response) {
    const result = await this.comments.export(this.filter(query));
    if (result.background) { response.status(202).json({ jobId: result.jobId, jobIds: result.jobIds }); return; }
    response.type('text/csv; charset=utf-8'); response.setHeader('Content-Disposition', 'attachment; filename="comments.csv"'); result.stream.pipe(response);
  }
}
