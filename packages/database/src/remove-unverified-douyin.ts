import type { DatabaseClient } from './client';

type CleanupDb = Pick<DatabaseClient, 'account' | '$transaction'>;
const cleanupWhere = () => ({ platform: 'douyin', identityVerifiedAt: null, connectorType: { in: ['xiaohuohua', 'mock'] } });

export async function findUnverifiedDouyin(db: Pick<DatabaseClient, 'account'>) {
  return db.account.findMany({ where: cleanupWhere(), select: { id: true, displayName: true, platformId: true, _count: { select: { notes: true } } }, orderBy: { id: 'asc' } });
}

export async function removeUnverifiedDouyin(db: CleanupDb, commit = false) {
  const accounts = await findUnverifiedDouyin(db);
  if (!commit || !accounts.length) return { committed: false, accounts };
  const ids = accounts.map(({ id }) => id);
  await db.$transaction(async (tx) => {
    const notes = await tx.note.findMany({ where: { accountId: { in: ids } }, select: { id: true } }); const noteIds = notes.map(({ id }) => id);
    await tx.comment.deleteMany({ where: { noteId: { in: noteIds } } });
    await tx.metricSnapshot.deleteMany({ where: { noteId: { in: noteIds } } });
    await tx.commentSyncCompleteness.deleteMany({ where: { accountId: { in: ids } } });
    await tx.backfillEvent.deleteMany({ where: { accountId: { in: ids } } });
    await tx.note.deleteMany({ where: { accountId: { in: ids } } });
    await tx.syncJob.deleteMany({ where: { accountId: { in: ids } } });
    await tx.report.deleteMany({ where: { accountId: { in: ids } } });
    await tx.notification.deleteMany({ where: { accountId: { in: ids } } });
    await tx.connectorCapability.deleteMany({ where: { accountId: { in: ids } } });
    await tx.account.deleteMany({ where: { id: { in: ids }, ...cleanupWhere() } });
  });
  return { committed: true, accounts };
}
