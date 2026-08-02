import type { Page, XhsConnector } from '@xhs/connector';

import { SyncRepository, type SyncStage } from './sync.repository';

export interface SyncResult {
  jobId: string;
  accountId: string;
  status: 'complete' | 'unverifiable';
}

const STAGES: SyncStage[] = ['authorize', 'notes', 'metrics', 'comments', 'replies', 'complete'];

export class SyncService {
  constructor(private readonly connector: XhsConnector, private readonly repository: SyncRepository) {}

  async runAccountSync(jobId: string, accountId: string): Promise<SyncResult> {
    const job = await this.repository.startJob(jobId, accountId);
    try {
      for (const stage of STAGES.slice(STAGES.indexOf(job.currentStage as SyncStage))) {
        if (stage === 'authorize') await this.authorize(jobId, accountId);
        if (stage === 'notes') {
          const valid = await this.notes(jobId, accountId, job.account.platformId);
          if (!valid) return { jobId, accountId, status: 'unverifiable' };
        }
        if (stage === 'metrics') await this.metrics(jobId, accountId);
        if (stage === 'comments') {
          const valid = await this.comments(jobId, accountId);
          if (!valid) return { jobId, accountId, status: 'unverifiable' };
        }
        if (stage === 'replies') {
          const valid = await this.replies(jobId, accountId);
          if (!valid) return { jobId, accountId, status: 'unverifiable' };
        }
        if (stage === 'complete') await this.repository.complete(jobId);
      }
      return { jobId, accountId, status: 'complete' };
    } catch (error) {
      await this.repository.fail(jobId, error);
      throw error;
    }
  }

  private async authorize(jobId: string, accountId: string) {
    await this.repository.saveCapabilities(jobId, accountId, await this.connector.getCapabilities());
  }

  private async notes(jobId: string, accountId: string, platformId: string) {
    const key = platformId;
    const checkpoint = await this.repository.checkpoint(jobId, 'notes', key);
    if (!checkpoint?.completed) {
      const ok = await this.paginate(
        checkpoint?.cursor ?? null,
        (cursor) => this.connector.listNotes({ accountId: platformId, cursor }),
        (items, cursor, repeated) => this.repository.saveNotesPage(jobId, accountId, key, items, cursor, repeated),
      );
      if (!ok) return false;
    }
    await this.repository.advance(jobId, 'metrics');
    return true;
  }

  private async metrics(jobId: string, accountId: string) {
    for (const note of await this.repository.notes(accountId)) {
      if ((await this.repository.checkpoint(jobId, 'metrics', note.platformId))?.completed) continue;
      await this.repository.saveMetrics(jobId, note.connectorType, note.platformId, await this.connector.getNoteMetrics({ noteId: note.platformId }));
    }
    await this.repository.advance(jobId, 'comments');
  }

  private async comments(jobId: string, accountId: string) {
    const notes = await this.repository.notes(accountId);
    if (!(await this.repository.commentsCapabilityEnabled(accountId))) {
      await Promise.all(notes.map((note) => this.repository.markCommentIncomplete(note.connectorType, accountId, note.platformId, 'authorization_required')));
      await this.repository.advance(jobId, 'replies');
      return true;
    }
    for (const note of notes) {
      const checkpoint = await this.repository.checkpoint(jobId, 'comments', note.platformId);
      if (checkpoint?.completed) continue;
      let ok: boolean;
      try {
        ok = await this.paginate(
          checkpoint?.cursor ?? null,
          (cursor) => this.connector.listComments({ noteId: note.platformId, cursor }),
          (items, cursor, repeated) => this.repository.saveCommentsPage(jobId, accountId, note.connectorType, note.platformId, items, cursor, repeated),
        );
      } catch (error) {
        await this.repository.markCommentIncomplete(
          note.connectorType,
          accountId,
          note.platformId,
          isAuthorizationError(error) ? 'authorization_required' : 'failed',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
      if (!ok) return false;
    }
    await this.repository.advance(jobId, 'replies');
    return true;
  }

  private async replies(jobId: string, accountId: string) {
    for (const comment of await this.repository.topLevelComments(accountId)) {
      const commentId = comment.platformId;
      const checkpoint = await this.repository.checkpoint(jobId, 'replies', commentId);
      if (checkpoint?.completed) continue;
      const ok = await this.paginate(
        checkpoint?.cursor ?? null,
        (cursor) => this.connector.listReplies({ commentId, cursor }),
        (items, cursor, repeated) => this.repository.saveRepliesPage(jobId, comment.connectorType, commentId, items, cursor, repeated),
      );
      if (!ok) return false;
    }
    await this.repository.advance(jobId, 'complete');
    return true;
  }

  private async paginate<T>(
    initialCursor: string | null,
    load: (cursor: string | null) => Promise<Page<T>>,
    save: (items: T[], nextCursor: string | null, repeated: boolean) => Promise<void>,
  ) {
    let cursor = initialCursor;
    const seen = new Set(cursor === null ? [] : [cursor]);
    while (true) {
      const page = await load(cursor);
      const repeated = page.nextCursor !== null && seen.has(page.nextCursor);
      await save(page.items, page.nextCursor, repeated);
      if (repeated) return false;
      if (page.nextCursor === null) return true;
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  }
}

function isAuthorizationError(error: unknown) {
  if (typeof error !== 'object' || error === null) return false;
  if ('status' in error && (error.status === 401 || error.status === 403)) return true;
  if ('statusCode' in error && (error.statusCode === 401 || error.statusCode === 403)) return true;
  return 'response' in error && typeof error.response === 'object' && error.response !== null && 'status' in error.response && (error.response.status === 401 || error.response.status === 403);
}
