import type { Account, Comment, Note, NoteMetric, Reply } from '../types';

export const accounts: Account[] = Array.from({ length: 3 }, (_, accountIndex) => ({
  platformId: `account-${accountIndex + 1}`,
  displayName: `Mock account ${accountIndex + 1}`,
  source: 'mock',
}));

export const notes: Note[] = accounts.flatMap((account, accountIndex) =>
  Array.from({ length: 4 }, (_, noteIndex) => {
    const sequence = accountIndex * 4 + noteIndex + 1;
    return {
      platformId: `note-${sequence}`,
      accountId: account.platformId,
      title: `Mock note ${sequence}`,
      publishedAt: new Date(Date.UTC(2026, 6, sequence)).toISOString(),
      source: 'mock' as const,
    };
  }),
);

export const comments: Comment[] = notes.flatMap((note) =>
  Array.from({ length: 12 }, (_, commentIndex) => ({
    platformId: `comment-${note.platformId}-${commentIndex + 1}`,
    noteId: note.platformId,
    authorName: `Mock user ${commentIndex + 1}`,
    content: `Mock comment ${commentIndex + 1} on ${note.platformId}`,
    createdAt: new Date(Date.UTC(2026, 6, 15, 0, commentIndex)).toISOString(),
    source: 'mock' as const,
  })),
);

export const replies: Reply[] = notes.flatMap((note) => {
  const parentCommentId = `comment-${note.platformId}-1`;
  return Array.from({ length: 2 }, (_, replyIndex) => ({
    platformId: `reply-${note.platformId}-1-${replyIndex + 1}`,
    parentCommentId,
    noteId: note.platformId,
    authorName: `Mock reply user ${replyIndex + 1}`,
    content: `Mock reply ${replyIndex + 1} on ${parentCommentId}`,
    createdAt: new Date(Date.UTC(2026, 6, 15, 1, replyIndex)).toISOString(),
    source: 'mock' as const,
  }));
});

export const noteMetrics: NoteMetric[] = notes.flatMap((note, noteIndex) =>
  Array.from({ length: 30 }, (_, dayIndex) => ({
    noteId: note.platformId,
    capturedAt: new Date(Date.UTC(2026, 6, dayIndex + 1)).toISOString(),
    views: (noteIndex + 1) * 1000 + dayIndex * 20,
    likes: (noteIndex + 1) * 100 + dayIndex * 3,
    comments: 12,
    source: 'mock' as const,
  })),
);
