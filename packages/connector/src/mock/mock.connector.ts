import type { XhsConnector } from '../connector';
import type {
  AuthorizationRequest,
  Comment,
  ConnectorCapabilities,
  Credential,
  CursorInput,
  ListCommentsInput,
  ListNotesInput,
  ListRepliesInput,
  Note,
  NoteMetric,
  Page,
  Reply,
} from '../types';
import { comments, noteMetrics, notes, replies } from './fixtures';

const MOCK_STATE = 'mock-authorization-state';

export class MockXhsConnector implements XhsConnector {
  async getCapabilities(): Promise<ConnectorCapabilities> {
    return {
      source: 'mock',
      authorization: true,
      notes: true,
      noteMetrics: true,
      comments: true,
      replies: true,
    };
  }

  async beginAuthorization(input: { redirectUri: string }): Promise<AuthorizationRequest> {
    const url = new URL('https://authorization.mock.invalid/authorize');
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('state', MOCK_STATE);
    return { authorizationUrl: url.toString(), state: MOCK_STATE, source: 'mock' };
  }

  async completeAuthorization(input: { code: string; state: string }): Promise<Credential> {
    if (!input.code || input.state !== MOCK_STATE) {
      throw new Error('Invalid mock authorization response');
    }
    return credential();
  }

  async listNotes(input: ListNotesInput): Promise<Page<Note>> {
    return paginate(
      notes.filter((note) => note.accountId === input.accountId),
      input,
    );
  }

  async getNoteMetrics(input: { noteId: string }): Promise<NoteMetric[]> {
    return noteMetrics.filter((metric) => metric.noteId === input.noteId);
  }

  async listComments(input: ListCommentsInput): Promise<Page<Comment>> {
    return paginate(
      comments.filter((comment) => comment.noteId === input.noteId),
      input,
    );
  }

  async listReplies(input: ListRepliesInput): Promise<Page<Reply>> {
    return paginate(
      replies.filter((reply) => reply.parentCommentId === input.commentId),
      input,
    );
  }

  async refreshCredential(input: { refreshToken: string }): Promise<Credential> {
    if (!input.refreshToken) {
      throw new Error('Refresh token is required');
    }
    return credential();
  }
}

function paginate<T>(items: readonly T[], input: CursorInput): Page<T> {
  const offset = decodeCursor(input.cursor, items.length);
  const limit = input.limit ?? 5;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('Invalid page limit');
  }

  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  const hasMore = nextOffset < items.length;
  return {
    items: pageItems,
    hasMore,
    nextCursor: hasMore ? encodeCursor(nextOffset) : null,
  };
}

function decodeCursor(cursor: string | null | undefined, itemCount: number): number {
  if (cursor == null) return 0;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(cursor)) {
    throw new Error('Invalid cursor');
  }

  const decoded = atob(cursor);
  if (!/^(0|[1-9]\d*)$/.test(decoded)) throw new Error('Invalid cursor');
  const offset = Number(decoded);
  if (!Number.isSafeInteger(offset) || offset > itemCount) throw new Error('Invalid cursor');
  return offset;
}

function encodeCursor(offset: number): string {
  return btoa(String(offset));
}

function credential(): Credential {
  return {
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresAt: '2099-01-01T00:00:00.000Z',
    source: 'mock',
  };
}
