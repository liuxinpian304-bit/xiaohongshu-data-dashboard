import type {
  AuthorizationRequest,
  ConnectorCapabilities,
  Credential,
  ListCommentsInput,
  ListNotesInput,
  ListRepliesInput,
  Note,
  NoteMetric,
  Page,
  Comment,
  Reply,
} from './types';

export interface XhsConnector {
  getCapabilities(): Promise<ConnectorCapabilities>;
  beginAuthorization(input: { redirectUri: string }): Promise<AuthorizationRequest>;
  completeAuthorization(input: { code: string; state: string }): Promise<Credential>;
  listNotes(input: ListNotesInput): Promise<Page<Note>>;
  getNoteMetrics(input: { noteId: string }): Promise<NoteMetric[]>;
  listComments(input: ListCommentsInput): Promise<Page<Comment>>;
  listReplies(input: ListRepliesInput): Promise<Page<Reply>>;
  refreshCredential(input: { refreshToken: string }): Promise<Credential>;
  revokeAuthorization?(input: { accountId: string }): Promise<{ revoked: true }>;
}
