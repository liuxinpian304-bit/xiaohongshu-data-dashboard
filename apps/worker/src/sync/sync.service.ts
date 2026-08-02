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
        (items, cursor) => this.repository.saveNotesPage(jobId, accountId, key, items, cursor),
        () => this.repository.markUnverifiable(jobId, `repeated notes cursor for ${key}`),
      );
      if (!ok) return false;
    }
    await this.repository.advance(jobId, 'metrics');
    return true;
  }

  private async metrics(jobId: string, accountId: string) {
    for (const note of await this.repository.notes(accountId)) {
      if ((await this.repository.checkpoint(jobId, 'metrics', note.platformId))?.completed) continue;
      await this.repository.saveMetrics(jobId, note.platformId, await this.connector.getNoteMetrics({ noteId: note.platformId }));
    }
    await this.repository.advance(jobId, 'comments');
  }

  private async comments(jobId: string, accountId: string) {
    for (const note of await this.repository.notes(accountId)) {
      const checkpoint = await this.repository.checkpoint(jobId, 'comments', note.platformId);
      if (checkpoint?.completed) continue;
      const ok = await this.paginate(
        checkpoint?.cursor ?? null,
        (cursor) => this.connector.listComments({ noteId: note.platformId, cursor }),
        (items, cursor) => this.repository.saveCommentsPage(jobId, note.platformId, items, cursor),
        () => this.repository.markUnverifiable(jobId, `repeated comments cursor for ${note.platformId}`),
      );
      if (!ok) return false;
    }
    await this.repository.advance(jobId, 'replies');
    return true;
  }

  private async replies(jobId: string, accountId: string) {
    for (const commentId of await this.repository.topLevelCommentIds(accountId)) {
      const checkpoint = await this.repository.checkpoint(jobId, 'replies', commentId);
      if (checkpoint?.completed) continue;
      const ok = await this.paginate(
        checkpoint?.cursor ?? null,
        (cursor) => this.connector.listReplies({ commentId, cursor }),
        (items, cursor) => this.repository.saveRepliesPage(jobId, commentId, items, cursor),
        () => this.repository.markUnverifiable(jobId, `repeated replies cursor for ${commentId}`),
      );
      if (!ok) return false;
    }
    await this.repository.advance(jobId, 'complete');
    return true;
  }

  private async paginate<T>(
    initialCursor: string | null,
    load: (cursor: string | null) => Promise<Page<T>>,
    save: (items: T[], nextCursor: string | null) => Promise<void>,
    repeated: () => Promise<void>,
  ) {
    let cursor = initialCursor;
    const seen = new Set(cursor === null ? [] : [cursor]);
    while (true) {
      const page = await load(cursor);
      if (page.nextCursor !== null && seen.has(page.nextCursor)) {
        await repeated();
        return false;
      }
      await save(page.items, page.nextCursor);
      if (page.nextCursor === null) return true;
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  }
}
