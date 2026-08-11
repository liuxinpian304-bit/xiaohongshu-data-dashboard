import type { DouyinIdentity, DouyinSessionRecord } from './douyin-types';
import type { DouyinSessionStore } from './douyin-session-store';
import type { DouyinLoginState } from './douyin-page-adapter';
import { CollectionRun, type CollectionProgress } from '../collection-run';

export type DouyinSessionState = 'idle' | 'launching' | 'awaiting_scan' | 'authenticated' | 'verification_required' | 'expired' | 'error' | 'closed';
export interface DouyinSessionStatus {
  sessionId: string;
  state: DouyinSessionState;
  changedAt: string;
  identity?: DouyinIdentity;
  identityVerifiedAt?: string;
  qrExpiresAt?: string;
}

interface Adapter {
  detectLoginState(): Promise<DouyinLoginState>;
  readIdentity(): Promise<DouyinIdentity>;
  captureQr(): Promise<Buffer>;
}

interface Handle { close(): Promise<void> }

export class DouyinSessionManager {
  private current: DouyinSessionStatus;
  private handle: Handle | null = null;
  private qrBytes: Buffer | null = null;
  private readonly collection: CollectionRun<unknown>;

  constructor(private readonly record: DouyinSessionRecord, private readonly options: {
    store: Pick<DouyinSessionStore, 'bindIdentity'>;
    adapter: Adapter;
    launch: (profileDirectory: string) => Promise<Handle>;
    collect?: (identity: DouyinIdentity, progress: (value: CollectionProgress) => void, emit: (event: unknown) => void, runId: string) => Promise<void>;
  }) {
    this.current = { sessionId: record.sessionId, state: 'idle', changedAt: new Date().toISOString() };
    this.collection = new CollectionRun({ collect: async (progress, emit, runId) => {
      if (!options.collect) throw new Error('collector_events_unavailable');
      const state = await options.adapter.detectLoginState();
      if (state !== 'authenticated') throw new Error(state === 'verification_required' ? 'douyin_verification_required' : 'douyin_identity_unavailable');
      const identity = await options.adapter.readIdentity();
      const boundId = this.current.identity?.platformId ?? this.record.platformId;
      if (!boundId || identity.platformId !== boundId) throw new Error('douyin_identity_mismatch');
      await options.collect(identity, progress, emit, runId);
    } });
  }

  status() { return { ...this.current }; }

  async start() {
    if (this.handle) return this.refresh();
    this.setState('launching');
    try {
      this.handle = await this.options.launch(this.record.profileDirectory);
      return this.refresh();
    } catch {
      this.setState('error');
      throw new Error('douyin_launch_failed');
    }
  }

  async refresh() {
    const state = await this.options.adapter.detectLoginState();
    if (state === 'loading') { this.setState('launching'); return this.status(); }
    if (state === 'verification_required') { this.destroyQr(); this.setState('verification_required'); return this.status(); }
    if (state === 'awaiting_scan') {
      this.qrBytes = await this.options.adapter.captureQr();
      const changedAt = new Date().toISOString();
      this.current = { sessionId: this.record.sessionId, state, changedAt, qrExpiresAt: new Date(Date.now() + 120_000).toISOString() };
      return this.status();
    }
    this.destroyQr();
    const identity = await this.options.adapter.readIdentity();
    if (this.record.platformId && identity.platformId !== this.record.platformId) throw new Error('douyin_identity_mismatch');
    const identityVerifiedAt = new Date().toISOString();
    await this.options.store.bindIdentity(this.record.sessionId, identity, identityVerifiedAt);
    this.current = { sessionId: this.record.sessionId, state: 'authenticated', changedAt: identityVerifiedAt, identity, identityVerifiedAt };
    return this.status();
  }

  qr() {
    if (!this.qrBytes || this.current.state !== 'awaiting_scan' || !this.current.qrExpiresAt || Date.now() >= Date.parse(this.current.qrExpiresAt)) throw new Error('douyin_qr_expired');
    return { bytes: Buffer.from(this.qrBytes), contentType: 'image/png' as const, expiresAt: this.current.qrExpiresAt };
  }

  startCollection() { return this.collection.start(); }
  collectionStatus() { return this.collection.status(); }
  collectionEvents(runId: string) { return this.collection.events(runId); }

  async close() {
    await this.handle?.close();
    this.handle = null;
    this.destroyQr();
    this.setState('closed');
    return this.status();
  }

  private setState(state: DouyinSessionState) {
    this.current = { sessionId: this.record.sessionId, state, changedAt: new Date().toISOString() };
  }

  private destroyQr() { this.qrBytes?.fill(0); this.qrBytes = null; }
}
