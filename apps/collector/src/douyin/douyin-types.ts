export interface DouyinIdentity {
  platformId: string;
  douyinAccountId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface DouyinSessionRecord {
  sessionId: string;
  platformId: string | null;
  profileDirectory: string;
  identityVerifiedAt: string | null;
}
