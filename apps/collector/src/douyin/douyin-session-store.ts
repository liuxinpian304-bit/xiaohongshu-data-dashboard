import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { DouyinIdentity, DouyinSessionRecord } from './douyin-types';

interface StoredSession {
  sessionId: string;
  platformId: string | null;
  identityVerifiedAt: string | null;
}

interface StoredMap {
  version: 1;
  sessions: StoredSession[];
}

export class DouyinSessionStore {
  private readonly mapPath: string;

  constructor(private readonly root: string) {
    this.mapPath = join(root, 'sessions.json');
  }

  async create(): Promise<DouyinSessionRecord> {
    await this.ensureRoot();
    const sessionId = randomUUID();
    const profileDirectory = join(this.root, sessionId);
    await mkdir(profileDirectory, { recursive: false, mode: 0o700 });
    await chmod(profileDirectory, 0o700);
    const map = await this.readMap();
    map.sessions.push({ sessionId, platformId: null, identityVerifiedAt: null });
    await this.writeMap(map);
    return { sessionId, platformId: null, profileDirectory, identityVerifiedAt: null };
  }

  async list(): Promise<DouyinSessionRecord[]> {
    await this.ensureRoot();
    const map = await this.readMap();
    return map.sessions.map((session) => ({ ...session, profileDirectory: join(this.root, session.sessionId) }));
  }

  async open(sessionId: string): Promise<DouyinSessionRecord> {
    validateSessionId(sessionId);
    const session = (await this.list()).find((candidate) => candidate.sessionId === sessionId);
    if (!session) throw new Error('douyin_session_not_found');
    return session;
  }

  async bindIdentity(sessionId: string, identity: DouyinIdentity, identityVerifiedAt: string): Promise<DouyinSessionRecord> {
    validateSessionId(sessionId);
    validateIdentity(identity);
    if (!Number.isFinite(Date.parse(identityVerifiedAt))) throw new Error('invalid_douyin_identity_verified_at');
    const map = await this.readMap();
    const index = map.sessions.findIndex((session) => session.sessionId === sessionId);
    if (index < 0) throw new Error('douyin_session_not_found');
    map.sessions[index] = { sessionId, platformId: identity.platformId, identityVerifiedAt };
    await this.writeMap(map);
    return { ...map.sessions[index], profileDirectory: join(this.root, sessionId) };
  }

  async remove(sessionId: string, deleteProfile = false): Promise<void> {
    validateSessionId(sessionId);
    const map = await this.readMap();
    const sessions = map.sessions.filter((session) => session.sessionId !== sessionId);
    if (sessions.length === map.sessions.length) throw new Error('douyin_session_not_found');
    await this.writeMap({ version: 1, sessions });
    if (deleteProfile) await rm(join(this.root, sessionId), { recursive: true, force: true });
  }

  private async ensureRoot() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
  }

  private async readMap(): Promise<StoredMap> {
    await this.ensureRoot();
    try {
      const info = await stat(this.mapPath);
      if (info.size > 1024 * 1024) throw new Error('invalid_douyin_session_map');
      const parsed: unknown = JSON.parse(await readFile(this.mapPath, 'utf8'));
      return validateMap(parsed);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { version: 1, sessions: [] };
      throw error instanceof Error && error.message === 'invalid_douyin_session_map' ? error : new Error('invalid_douyin_session_map');
    }
  }

  private async writeMap(map: StoredMap) {
    await this.ensureRoot();
    const temporary = join(this.root, `.sessions-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(map), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(temporary, 0o600);
    await rename(temporary, this.mapPath);
    await chmod(this.mapPath, 0o600);
  }
}

function validateSessionId(sessionId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) throw new Error('invalid_douyin_session_id');
}

function validateIdentity(identity: DouyinIdentity) {
  if (!/^douyin:[A-Za-z0-9_-]{1,190}$/.test(identity.platformId)) throw new Error('invalid_douyin_identity');
  if (!identity.douyinAccountId || identity.douyinAccountId.length > 200 || !identity.displayName || identity.displayName.length > 200) throw new Error('invalid_douyin_identity');
  if (identity.avatarUrl !== null) {
    try { if (new URL(identity.avatarUrl).protocol !== 'https:') throw new Error(); } catch { throw new Error('invalid_douyin_identity'); }
  }
}

function validateMap(value: unknown): StoredMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_douyin_session_map');
  const root = value as Record<string, unknown>;
  if (Object.keys(root).some((key) => !['version', 'sessions'].includes(key)) || root.version !== 1 || !Array.isArray(root.sessions) || root.sessions.length > 1_000) throw new Error('invalid_douyin_session_map');
  const sessions = root.sessions.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('invalid_douyin_session_map');
    const session = entry as Record<string, unknown>;
    if (Object.keys(session).some((key) => !['sessionId', 'platformId', 'identityVerifiedAt'].includes(key)) || typeof session.sessionId !== 'string') throw new Error('invalid_douyin_session_map');
    validateSessionId(session.sessionId);
    if (session.platformId !== null && (typeof session.platformId !== 'string' || !/^douyin:[A-Za-z0-9_-]{1,190}$/.test(session.platformId))) throw new Error('invalid_douyin_session_map');
    if (session.identityVerifiedAt !== null && (typeof session.identityVerifiedAt !== 'string' || !Number.isFinite(Date.parse(session.identityVerifiedAt)))) throw new Error('invalid_douyin_session_map');
    return { sessionId: session.sessionId, platformId: session.platformId as string | null, identityVerifiedAt: session.identityVerifiedAt as string | null };
  });
  if (new Set(sessions.map(({ sessionId }) => sessionId)).size !== sessions.length) throw new Error('invalid_douyin_session_map');
  return { version: 1, sessions };
}
