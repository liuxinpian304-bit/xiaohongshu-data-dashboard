export type ConnectorSource = 'mock' | 'official';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ConnectorCapabilities {
  source: ConnectorSource;
  authorization: boolean;
  notes: boolean;
  noteMetrics: boolean;
  comments: boolean;
  replies: boolean;
}

export interface AuthorizationRequest {
  authorizationUrl: string;
  state: string;
  source: ConnectorSource;
}

export interface Credential {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  source: ConnectorSource;
}

export interface Account {
  platformId: string;
  displayName: string;
  source: ConnectorSource;
}

export interface Note {
  platformId: string;
  accountId: string;
  title: string;
  publishedAt: string;
  source: ConnectorSource;
}

export interface NoteMetric {
  noteId: string;
  capturedAt: string;
  views: number;
  likes: number;
  comments: number;
  source: ConnectorSource;
}

export interface Comment {
  platformId: string;
  noteId: string;
  authorName: string;
  content: string;
  createdAt: string;
  source: ConnectorSource;
}

export interface Reply extends Comment {
  parentCommentId: string;
}

export interface CursorInput {
  cursor?: string | null;
  limit?: number;
}

export interface ListNotesInput extends CursorInput {
  accountId: string;
}

export interface ListCommentsInput extends CursorInput {
  noteId: string;
}

export interface ListRepliesInput extends CursorInput {
  commentId: string;
}
