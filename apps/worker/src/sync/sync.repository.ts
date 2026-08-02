import type { Comment, ConnectorCapabilities, Note, NoteMetric, Reply } from '@xhs/connector';
import type { DatabaseClient, TransactionClient } from '@xhs/database';
import { createHash } from 'node:crypto';

export type SyncStage = 'authorize' | 'notes' | 'metrics' | 'comments' | 'replies' | 'complete';
export type CommentCompletenessStatus = 'partial' | 'page_complete' | 'failed' | 'authorization_required' | 'unverifiable';
export interface MetricBackfillEvent { backfillId: string; accountId: string; noteId: string; capturedDates: string[]; reason: string }

export class SyncRepository {
  constructor(
    private readonly db: DatabaseClient,
    private readonly onMetricSnapshotsCommitted?: (event: MetricBackfillEvent) => Promise<void>,
  ) {}

  async startJob(externalJobId: string, accountId: string) {
    return this.db.syncJob.upsert({
      where: { externalJobId },
      create: { externalJobId, accountId, status: 'running', startedAt: new Date() },
      update: { status: 'running', verificationStatus: 'verified', error: null, completedAt: null },
      include: { account: true },
    });
  }

  async advance(jobId: string, stage: SyncStage) {
    await this.db.syncJob.update({ where: { externalJobId: jobId }, data: { currentStage: stage } });
  }

  async saveCapabilities(jobId: string, accountId: string, capabilities: ConnectorCapabilities) {
    const values = Object.entries(capabilities).filter(([key]) => key !== 'source') as [string, boolean][];
    await this.db.$transaction(async (tx) => {
      for (const [capability, enabled] of values) {
        await tx.connectorCapability.upsert({
          where: { accountId_capability: { accountId, capability } },
          create: { accountId, capability, enabled },
          update: { enabled, checkedAt: new Date() },
        });
      }
      await tx.syncJob.update({ where: { externalJobId: jobId }, data: { currentStage: 'notes' } });
    });
  }

  async checkpoint(jobId: string, stage: SyncStage, entityKey: string) {
    return this.db.syncCheckpoint.findFirst({
      where: { syncJob: { externalJobId: jobId }, stage, entityKey },
    });
  }

  async saveNotesPage(jobId: string, accountId: string, entityKey: string, notes: Note[], nextCursor: string | null, unverifiable = false) {
    await this.db.$transaction(async (tx) => {
      for (const note of notes) {
        await tx.note.upsert({
          where: { connectorType_platformId: { connectorType: note.source, platformId: note.platformId } },
          create: { accountId, connectorType: note.source, platformId: note.platformId, title: note.title, publishedAt: new Date(note.publishedAt) },
          update: { title: note.title, publishedAt: new Date(note.publishedAt), lastSeenAt: new Date() },
        });
      }
      await this.upsertCheckpoint(tx, jobId, 'notes', entityKey, nextCursor);
      if (unverifiable) await this.markUnverifiableInTransaction(tx, jobId, `repeated notes cursor for ${entityKey}`);
    });
  }

  async saveMetrics(jobId: string, connectorType: string, notePlatformId: string, metrics: NoteMetric[]) {
    const event = await this.db.$transaction(async (tx) => {
      const note = await tx.note.findUniqueOrThrow({ where: { connectorType_platformId: { connectorType, platformId: notePlatformId } } });
      const capturedDates = backfillBusinessDates(metrics);
      const backfillId = createHash('sha256').update(`${jobId}\0${note.id}\0${capturedDates.join(',')}`).digest('hex').slice(0, 32);
      const definitions = [
        ['views', '浏览量'], ['likes', '点赞量'], ['comments', '评论量'],
      ] as const;
      for (const [key, displayName] of definitions) {
        const definition = await tx.metricDefinition.upsert({
          where: { key }, create: { key, displayName, unit: 'count' }, update: {},
        });
        for (const metric of metrics) {
          await tx.metricSnapshot.upsert({
            where: { noteId_metricDefinitionId_capturedAt: { noteId: note.id, metricDefinitionId: definition.id, capturedAt: new Date(metric.capturedAt) } },
            create: { noteId: note.id, metricDefinitionId: definition.id, availability: 'available', value: metric[key], capturedAt: new Date(metric.capturedAt), source: metric.source },
            update: { availability: 'available', value: metric[key], source: metric.source },
          });
        }
      }
      await this.upsertCheckpoint(tx, jobId, 'metrics', notePlatformId, null);
      await tx.backfillEvent.upsert({
        where: { id: backfillId },
        create: { id: backfillId, accountId: note.accountId, noteId: note.id, capturedDates },
        update: {},
      });
      return { backfillId, accountId: note.accountId, noteId: note.id, capturedDates, reason: 'metric_snapshot_saved' };
    });
    try { await this.onMetricSnapshotsCommitted?.(event); } catch { /* pending outbox is retried by the worker scanner */ }
  }

  async saveCommentsPage(jobId: string, accountId: string, connectorType: string, notePlatformId: string, comments: Comment[], nextCursor: string | null, unverifiable = false) {
    await this.db.$transaction(async (tx) => {
      const note = await tx.note.findUniqueOrThrow({ where: { connectorType_platformId: { connectorType, platformId: notePlatformId } } });
      for (const comment of comments) {
        await tx.comment.upsert({
          where: { connectorType_platformId: { connectorType: comment.source, platformId: comment.platformId } },
          create: { noteId: note.id, connectorType: comment.source, platformId: comment.platformId, parentPlatformId: null, content: comment.content, publishedAt: new Date(comment.createdAt), source: comment.source },
          update: { noteId: note.id, content: comment.content, publishedAt: new Date(comment.createdAt), lastSeenAt: new Date() },
        });
      }
      await this.upsertCheckpoint(tx, jobId, 'comments', notePlatformId, nextCursor);
      await this.upsertCommentCompleteness(
        tx,
        connectorType,
        accountId,
        notePlatformId,
        unverifiable ? 'unverifiable' : nextCursor === null ? 'page_complete' : 'partial',
        nextCursor,
        unverifiable ? `repeated comments cursor for ${notePlatformId}` : null,
      );
      if (unverifiable) await this.markUnverifiableInTransaction(tx, jobId, `repeated comments cursor for ${notePlatformId}`);
    });
  }

  async saveRepliesPage(jobId: string, connectorType: string, replyKey: string, replies: Reply[], nextCursor: string | null, unverifiable = false) {
    await this.db.$transaction(async (tx) => {
      for (const reply of replies) {
        const note = await tx.note.findUniqueOrThrow({ where: { connectorType_platformId: { connectorType, platformId: reply.noteId } } });
        await tx.comment.upsert({
          where: { connectorType_platformId: { connectorType: reply.source, platformId: reply.platformId } },
          create: { noteId: note.id, connectorType: reply.source, platformId: reply.platformId, parentPlatformId: reply.parentCommentId, content: reply.content, publishedAt: new Date(reply.createdAt), source: reply.source },
          update: { content: reply.content, publishedAt: new Date(reply.createdAt), lastSeenAt: new Date() },
        });
      }
      await this.upsertCheckpoint(tx, jobId, 'replies', replyKey, nextCursor);
      if (unverifiable) await this.markUnverifiableInTransaction(tx, jobId, `repeated replies cursor for ${replyKey}`);
    });
  }

  async notes(accountId: string) { return this.db.note.findMany({ where: { accountId }, orderBy: { platformId: 'asc' } }); }
  async topLevelComments(accountId: string) {
    return this.db.comment.findMany({
      where: { note: { accountId }, parentPlatformId: null },
      select: { platformId: true, connectorType: true },
    });
  }
  async countComments(notePlatformId: string) { return this.db.comment.count({ where: { note: { platformId: notePlatformId }, parentPlatformId: null } }); }
  async getCommentCursor(jobId: string, notePlatformId: string) { return (await this.checkpoint(jobId, 'comments', notePlatformId))?.cursor ?? null; }
  async getCommentCompleteness(connectorType: string, accountId: string, notePlatformId: string) {
    return (await this.db.commentSyncCompleteness.findUnique({
      where: { connectorType_accountId_notePlatformId: { connectorType, accountId, notePlatformId } },
      select: { status: true },
    }))?.status ?? null;
  }
  async commentsCapabilityEnabled(accountId: string) {
    return (await this.db.connectorCapability.findUnique({
      where: { accountId_capability: { accountId, capability: 'comments' } }, select: { enabled: true },
    }))?.enabled ?? false;
  }
  async markCommentIncomplete(connectorType: string, accountId: string, notePlatformId: string, status: Exclude<CommentCompletenessStatus, 'partial' | 'page_complete'>, error?: string) {
    await this.db.commentSyncCompleteness.upsert({
      where: { connectorType_accountId_notePlatformId: { connectorType, accountId, notePlatformId } },
      create: { connectorType, accountId, notePlatformId, status, cursor: null, error: error ?? null },
      update: { status, error: error ?? null },
    });
  }

  async markUnverifiable(jobId: string, reason: string) {
    await this.db.syncJob.update({ where: { externalJobId: jobId }, data: { status: 'failed', verificationStatus: 'unverifiable', error: reason } });
  }
  async fail(jobId: string, error: unknown) {
    await this.db.syncJob.update({ where: { externalJobId: jobId }, data: { status: 'failed', error: error instanceof Error ? error.message : String(error) } });
  }
  async complete(jobId: string) {
    await this.db.syncJob.update({ where: { externalJobId: jobId }, data: { status: 'succeeded', currentStage: 'complete', completedAt: new Date() } });
  }

  private async upsertCheckpoint(tx: TransactionClient, jobId: string, stage: SyncStage, entityKey: string, cursor: string | null) {
    const job = await tx.syncJob.findUniqueOrThrow({ where: { externalJobId: jobId }, select: { id: true } });
    await tx.syncCheckpoint.upsert({
      where: { syncJobId_stage_entityKey: { syncJobId: job.id, stage, entityKey } },
      create: { syncJobId: job.id, stage, entityKey, cursor, completed: cursor === null },
      update: { cursor, completed: cursor === null },
    });
  }

  private async upsertCommentCompleteness(tx: TransactionClient, connectorType: string, accountId: string, notePlatformId: string, status: CommentCompletenessStatus, cursor: string | null, error: string | null) {
    await tx.commentSyncCompleteness.upsert({
      where: { connectorType_accountId_notePlatformId: { connectorType, accountId, notePlatformId } },
      create: { connectorType, accountId, notePlatformId, status, cursor, error },
      update: { status, cursor, error },
    });
  }

  private async markUnverifiableInTransaction(tx: TransactionClient, jobId: string, reason: string) {
    await tx.syncJob.update({
      where: { externalJobId: jobId },
      data: { status: 'failed', verificationStatus: 'unverifiable', error: reason },
    });
  }
}

export function backfillBusinessDates(metrics: ReadonlyArray<{ capturedAt: string }>) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return [...new Set(metrics.map((metric) => formatter.format(new Date(metric.capturedAt))))].sort();
}
