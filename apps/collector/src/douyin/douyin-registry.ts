import type { DouyinSessionRecord } from './douyin-types';
import type { DouyinSessionStore } from './douyin-session-store';
import type { DouyinSessionState } from './douyin-session-manager';

interface PublicStatus {
  sessionId: string;
  state: DouyinSessionState;
  changedAt: string;
  identity?: unknown;
  identityVerifiedAt?: string;
  qrExpiresAt?: string;
}

interface ManagerLike {
  start(): Promise<Omit<PublicStatus, 'sessionId'>>;
  status(): Omit<PublicStatus, 'sessionId'>;
  refresh(): Promise<Omit<PublicStatus, 'sessionId'>>;
  qr(): { bytes: Buffer; contentType: 'image/png'; expiresAt: string };
  close(): Promise<Omit<PublicStatus, 'sessionId'>>;
}

export class DouyinRegistry {
  private readonly managers = new Map<string, ManagerLike>();

  constructor(private readonly store: DouyinSessionStore, private readonly factory: (record: DouyinSessionRecord) => ManagerLike) {}

  async createSession(): Promise<PublicStatus> {
    const record = await this.store.create();
    const manager = this.factory(record);
    this.managers.set(record.sessionId, manager);
    return this.public(record.sessionId, await manager.start());
  }

  async listSessions(): Promise<PublicStatus[]> {
    const records = await this.store.list();
    return records.map((record) => {
      const manager = this.managers.get(record.sessionId);
      if (manager) return this.public(record.sessionId, manager.status());
      return { sessionId: record.sessionId, state: 'idle', changedAt: record.identityVerifiedAt ?? new Date(0).toISOString(), ...(record.identityVerifiedAt ? { identityVerifiedAt: record.identityVerifiedAt } : {}) };
    });
  }

  async status(sessionId: string) {
    const manager = await this.manager(sessionId);
    return this.public(sessionId, manager.status());
  }

  async refresh(sessionId: string) {
    const manager = await this.manager(sessionId);
    return this.public(sessionId, await manager.refresh());
  }

  async qr(sessionId: string) { return (await this.manager(sessionId)).qr(); }

  async close(sessionId: string) {
    const manager = await this.manager(sessionId);
    const result = this.public(sessionId, await manager.close());
    this.managers.delete(sessionId);
    return result;
  }

  private async manager(sessionId: string) {
    const record = await this.store.open(sessionId);
    let manager = this.managers.get(sessionId);
    if (!manager) { manager = this.factory(record); this.managers.set(sessionId, manager); }
    return manager;
  }

  private public(sessionId: string, status: Omit<PublicStatus, 'sessionId'>): PublicStatus {
    return { sessionId, ...status };
  }
}
