import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@xhs/database';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { page } from '../common/pagination.dto';

export type CommentFilter = { platform?: 'xiaohongshu' | 'douyin'; accountId?: string; accountIds?: string[]; noteId?: string; from?: Date; to?: Date; keyword?: string; newOnly?: boolean };
export function commentWhere(f: CommentFilter) { const accountIds = f.accountId ? [f.accountId] : f.accountIds; return { ...(f.platform ? { platform: f.platform } : {}), ...(f.noteId ? { noteId: f.noteId } : {}), ...(accountIds ? { note: { accountId: { in: accountIds } } } : {}), ...(f.from || f.to ? { publishedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}), ...(f.keyword ? { content: { contains: f.keyword, mode: 'insensitive' as const } } : {}), ...(f.newOnly ? { firstSeenAt: { gte: new Date(Date.now() - 86_400_000) } } : {}) }; }
type ExportLimits = { maxRows: number; maxBytes: number; chunkSize: number };
const defaults: ExportLimits = { maxRows: 100_000, maxBytes: 50 * 1024 * 1024, chunkSize: 500 };
const csvCell = (value: unknown) => { let text = String(value ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
export const commentCsvHeader = 'id,noteId,platform,source,platformId,parentPlatformId,content,publishedAt,likeCount,capturedAt\r\n';
export const commentCsvRow = (row: { id: string; noteId: string | null; platform: string; source: string; platformId: string; parentPlatformId: string | null; content: string; publishedAt: Date; likeCount: number; lastSeenAt: Date }) => [row.id,row.noteId,row.platform,row.source,row.platformId,row.parentPlatformId,row.content,row.publishedAt.toISOString(),row.likeCount,row.lastSeenAt.toISOString()].map(csvCell).join(',') + '\r\n';

@Injectable()
export class CommentsService {
  constructor(private readonly limits: ExportLimits = defaults) {}
  private where(f: CommentFilter) { return commentWhere(f); }
  async ensureScope(f: CommentFilter) { const ids = f.accountId ? [f.accountId] : f.accountIds; if (ids && await prisma.account.count({ where: { id: { in: ids } } }) !== new Set(ids).size) throw new NotFoundException('managed account not found'); }
  async list(f: CommentFilter, cursor: string | undefined, limit: number) { await this.ensureScope(f); return page(await prisma.comment.findMany({ where: { ...this.where(f), ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: limit + 1 }), limit); }
  async export(f: CommentFilter) {
    await this.ensureScope(f);
    const directory = await mkdtemp(join(tmpdir(), 'xhs-comments-')); const filePath = join(directory, 'export.csv'); const file = await open(filePath, 'wx', 0o600);
    let snapshot: { rowCount: number; actualBytes: number; oversized: boolean };
    try {
      snapshot = await prisma.$transaction(async (tx) => {
        const header = commentCsvHeader; let actualBytes = Buffer.byteLength(header); let rowCount = 0; let cursor: string | undefined; let oversized = actualBytes > this.limits.maxBytes;
        if (!oversized) await file.write(header);
        while (!oversized && rowCount <= this.limits.maxRows) {
          const rows = await tx.comment.findMany({ where: { ...this.where(f), ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: this.limits.chunkSize });
          if (!rows.length) break;
          for (const row of rows) {
            rowCount++; cursor = row.id; const encoded = commentCsvRow(row); const encodedBytes = Buffer.byteLength(encoded, 'utf8');
            if (rowCount > this.limits.maxRows || actualBytes + encodedBytes > this.limits.maxBytes) { oversized = true; break; }
            await file.write(encoded); actualBytes += encodedBytes;
          }
          if (rows.length < this.limits.chunkSize) break;
        }
        return { rowCount, actualBytes, oversized };
      }, { isolationLevel: 'RepeatableRead', timeout: 120_000 });
    } catch (error) { await file.close(); await rm(directory, { recursive: true, force: true }); throw error; }
    await file.close();
    if (snapshot.oversized) {
      await rm(directory, { recursive: true, force: true });
      const accountIds = f.accountId ? [f.accountId] : f.accountIds ?? (await prisma.note.findMany({ where: { comments: { some: this.where(f) } }, distinct: ['accountId'], select: { accountId: true } })).map((row) => row.accountId);
      if (!accountIds.length) throw new BadRequestException('export scope has no managed accounts');
      const jobs = await prisma.$transaction(accountIds.map((accountId) => prisma.syncJob.create({ data: { accountId, currentStage: 'export_comments', payload: { accountIds, filter: { accountId, noteId: f.noteId ?? null, from: f.from?.toISOString() ?? null, to: f.to?.toISOString() ?? null, keyword: f.keyword ?? null, newOnly: f.newOnly ?? false }, requestedScope: { accountId: f.accountId ?? null, accountIds, noteId: f.noteId ?? null, from: f.from?.toISOString() ?? null, to: f.to?.toISOString() ?? null, keyword: f.keyword ?? null, newOnly: f.newOnly ?? false }, maxRows: this.limits.maxRows, maxBytes: this.limits.maxBytes } } })));
      return { background: true as const, jobId: jobs[0].id, jobIds: jobs.map((job) => job.id) };
    }
    const stream = createReadStream(filePath); const cleanup = () => { void rm(directory, { recursive: true, force: true }); }; stream.once('close', cleanup); stream.once('error', cleanup);
    return { background: false as const, stream, bytes: snapshot.actualBytes };
  }
}
