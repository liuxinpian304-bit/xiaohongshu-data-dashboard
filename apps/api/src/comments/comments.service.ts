import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@xhs/database';
import { Readable } from 'node:stream';
import { page } from '../common/pagination.dto';

export type CommentFilter = { accountId?: string; noteId?: string; from?: Date; to?: Date };
type ExportLimits = { maxRows: number; maxBytes: number; chunkSize: number };
const defaults: ExportLimits = { maxRows: 100_000, maxBytes: 50 * 1024 * 1024, chunkSize: 500 };
const csvCell = (value: unknown) => { let text = String(value ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };

@Injectable()
export class CommentsService {
  constructor(private readonly limits: ExportLimits = defaults) {}
  private where(f: CommentFilter) { return { ...(f.noteId ? { noteId: f.noteId } : {}), ...(f.accountId ? { note: { accountId: f.accountId } } : {}), ...(f.from || f.to ? { publishedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}) }; }
  async ensureScope(f: CommentFilter) { if (f.accountId && !(await prisma.account.count({ where: { id: f.accountId } }))) throw new NotFoundException('managed account not found'); }
  async list(f: CommentFilter, cursor: string | undefined, limit: number) { await this.ensureScope(f); return page(await prisma.comment.findMany({ where: { ...this.where(f), ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: limit + 1 }), limit); }
  async export(f: CommentFilter) {
    await this.ensureScope(f);
    const snapshot = await prisma.$transaction(async (tx) => {
      const ids: string[] = []; let cursor: string | undefined; let estimatedBytes = 64;
      while (ids.length <= this.limits.maxRows && estimatedBytes <= this.limits.maxBytes) {
        const rows = await tx.comment.findMany({ where: { ...this.where(f), ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: Math.min(this.limits.chunkSize, this.limits.maxRows + 1 - ids.length), select: { id: true, content: true } });
        if (!rows.length) break;
        for (const row of rows) { ids.push(row.id); estimatedBytes += Buffer.byteLength(row.content, 'utf8') + 160; cursor = row.id; if (ids.length > this.limits.maxRows || estimatedBytes > this.limits.maxBytes) break; }
        if (rows.length < this.limits.chunkSize) break;
      }
      return { ids, estimatedBytes };
    }, { isolationLevel: 'RepeatableRead' });
    const { ids, estimatedBytes } = snapshot;
    if (ids.length > this.limits.maxRows || estimatedBytes > this.limits.maxBytes) {
      const accountIds = f.accountId ? [f.accountId] : (await prisma.note.findMany({ where: { comments: { some: this.where(f) } }, distinct: ['accountId'], select: { accountId: true } })).map((row) => row.accountId);
      if (!accountIds.length) throw new BadRequestException('export scope has no managed accounts');
      const jobs = await prisma.$transaction(accountIds.map((accountId) => prisma.syncJob.create({ data: { accountId, currentStage: 'export_comments', payload: { accountIds, filter: { accountId: f.accountId ?? null, noteId: f.noteId ?? null, from: f.from?.toISOString() ?? null, to: f.to?.toISOString() ?? null }, maxRows: this.limits.maxRows, maxBytes: this.limits.maxBytes } } })));
      return { background: true as const, jobId: jobs[0].id, jobIds: jobs.map((job) => job.id) };
    }
    const chunkSize = this.limits.chunkSize;
    const stream = Readable.from((async function* () {
      yield 'id,noteId,content,publishedAt,likeCount\r\n';
      for (let offset = 0; offset < ids.length; offset += chunkSize) {
        const chunkIds = ids.slice(offset, offset + chunkSize);
        const rows = await prisma.comment.findMany({ where: { id: { in: chunkIds } }, orderBy: { id: 'asc' } });
        for (const row of rows) yield [row.id, row.noteId, row.content, row.publishedAt.toISOString(), row.likeCount].map(csvCell).join(',') + '\r\n';
      }
    })());
    return { background: false as const, stream };
  }
}
