import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@xhs/database';
import { page } from '../common/pagination.dto';

type SnapshotProjectionInput = {
  value: { toString(): string } | null;
  availability: string;
  source: string;
  observedAt: Date;
  capturedAt: Date;
  metricDefinition: { key: string; displayName: string; version: string; effectiveFrom: Date; effectiveTo: Date | null };
};

export function projectNoteMetrics(snapshots: SnapshotProjectionInput[]) {
  const seen = new Set<string>();
  return snapshots.flatMap((snapshot) => {
    const definition = snapshot.metricDefinition;
    if (snapshot.capturedAt < definition.effectiveFrom || (definition.effectiveTo && snapshot.capturedAt >= definition.effectiveTo) || seen.has(definition.key)) return [];
    seen.add(definition.key);
    return [{
      key: definition.key,
      displayName: definition.displayName,
      availability: snapshot.availability,
      value: snapshot.value?.toString() ?? null,
      source: snapshot.source,
      observedAt: snapshot.observedAt.toISOString(),
      capturedAt: snapshot.capturedAt.toISOString(),
      definitionVersion: definition.version,
    }];
  });
}

const snapshotInclude = {
  where: { supersededAt: null },
  orderBy: [{ capturedAt: 'desc' as const }, { observedAt: 'desc' as const }, { revision: 'desc' as const }],
  include: { metricDefinition: true },
};
export function noteWhere(input: { platform?: 'xiaohongshu' | 'douyin'; accountId?: string; cursor?: string }) { return { ...(input.platform ? { platform: input.platform } : {}), ...(input.accountId ? { accountId: input.accountId } : {}), ...(input.cursor ? { id: { gt: input.cursor } } : {}) }; }

@Injectable()
export class NotesService {
  async list(accountId: string | undefined, cursor: string | undefined, limit: number, platform?: 'xiaohongshu' | 'douyin') {
    const notes = await prisma.note.findMany({
      where: noteWhere({ platform, accountId, cursor }),
      orderBy: { id: 'asc' },
      take: limit + 1,
      include: { account: { select: { id: true, platform: true, displayName: true, platformId: true } }, snapshots: snapshotInclude },
    });
    const completeness = notes.length ? await prisma.commentSyncCompleteness.findMany({
      where: { OR: notes.map((note) => ({ connectorType: note.connectorType, accountId: note.accountId, notePlatformId: note.platformId })) },
    }) : [];
    const completenessByNote = new Map(completeness.map((item) => [`${item.connectorType}:${item.accountId}:${item.notePlatformId}`, item]));
    return page(notes.map(({ snapshots, ...note }) => {
      const state = completenessByNote.get(`${note.connectorType}:${note.accountId}:${note.platformId}`);
      return {
        ...note,
        metrics: projectNoteMetrics(snapshots),
        commentCompleteness: state ? { status: state.status, error: state.error, updatedAt: state.updatedAt.toISOString() } : null,
      };
    }), limit);
  }

  async detail(id: string) {
    const note = await prisma.note.findUnique({ where: { id }, include: { account: { select: { id: true, platform: true, displayName: true, platformId: true } }, snapshots: snapshotInclude } });
    if (!note) throw new NotFoundException('note not found');
    const completeness = await prisma.commentSyncCompleteness.findUnique({ where: { connectorType_accountId_notePlatformId: { connectorType: note.connectorType, accountId: note.accountId, notePlatformId: note.platformId } } });
    const { snapshots, ...base } = note;
    return {
      ...base,
      metrics: projectNoteMetrics(snapshots),
      commentCompleteness: completeness ? { status: completeness.status, error: completeness.error, updatedAt: completeness.updatedAt.toISOString() } : null,
    };
  }
}
