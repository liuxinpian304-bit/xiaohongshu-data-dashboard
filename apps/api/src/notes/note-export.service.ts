import { Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { prisma } from '@xhs/database';
import { createZip } from './zip-writer';
import { projectNoteMetrics } from './notes.service';

const BOM = '\ufeff';
const csvCell = (value: unknown) => { let text = String(value ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
const row = (values: unknown[]) => values.map(csvCell).join(',') + '\r\n';

@Injectable()
export class NoteExportService {
  async export(accountId?: string) {
    if (accountId && await prisma.account.count({ where: { id: accountId } }) !== 1) throw new NotFoundException('managed account not found');
    const notes = await prisma.note.findMany({
      where: accountId ? { accountId } : {}, orderBy: { id: 'asc' },
      include: { account: { select: { displayName: true, platformId: true } }, snapshots: { where: { supersededAt: null }, orderBy: [{ capturedAt: 'desc' }, { observedAt: 'desc' }, { revision: 'desc' }], include: { metricDefinition: true } } },
    });
    const comments = await prisma.comment.findMany({ where: accountId ? { note: { accountId } } : {}, orderBy: { id: 'asc' } });
    if (notes.length > 100_000 || comments.length > 100_000) throw new PayloadTooLargeException('export exceeds row limit');
    const noteLines = [BOM + row(['id','platformId','title','account','publishedAt','source','views','viewsAvailability','likes','likesAvailability','comments','commentsAvailability','favorites','favoritesAvailability'])];
    for (const note of notes) {
      const metrics = new Map(projectNoteMetrics(note.snapshots).map((metric) => [metric.key, metric]));
      noteLines.push(row([note.id,note.platformId,note.title,note.account.displayName ?? note.account.platformId,note.publishedAt.toISOString(),note.connectorType,...['views','likes','comments','favorites'].flatMap((key) => [metrics.get(key)?.value ?? '',metrics.get(key)?.availability ?? 'not_synced'])]));
    }
    const commentLines = [BOM + row(['id','noteId','platformId','parentPlatformId','content','publishedAt','likeCount','source'])];
    for (const comment of comments) commentLines.push(row([comment.id,comment.noteId,comment.platformId,comment.parentPlatformId,comment.content,comment.publishedAt.toISOString(),comment.likeCount,comment.source]));
    const readme = [`导出时间：${new Date().toISOString()}`,`账号筛选：${accountId ?? '全部账号'}`,`笔记数量：${notes.length}`,`评论与回复数量：${comments.length}`,'未知指标保留为空，不会用 0 替代。'].join('\r\n');
    const zip = createZip([{ name:'notes.csv',data:Buffer.from(noteLines.join('')) },{ name:'comments.csv',data:Buffer.from(commentLines.join('')) },{ name:'README.txt',data:Buffer.from(readme) }]);
    if (zip.length > 50 * 1024 * 1024) throw new PayloadTooLargeException('export exceeds byte limit');
    return zip;
  }
}
