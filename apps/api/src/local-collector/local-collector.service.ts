import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { importSelfScrapeCollection, prisma, type DatabaseClient } from '@xhs/database';

export type CollectorSessionAction = 'start' | 'status' | 'refresh' | 'close';
export type CollectorCollectionAction = 'sync' | 'sync-status';
export type CollectorAction = CollectorSessionAction | CollectorCollectionAction;
export interface CollectorStatus { state: 'idle' | 'launching' | 'awaiting_scan' | 'authenticated' | 'verification_required' | 'expired' | 'closed' | 'error'; changedAt: string; qrExpiresAt?: string; errorCode?: string }
export interface CollectorQr { bytes: Buffer; etag: string; expires: string }
export interface CollectorCollectionStatus { runId: string | null; state: 'idle' | 'running' | 'completed' | 'failed'; stage: 'account' | 'notes' | 'metrics' | 'comments' | 'replies' | 'writing' | 'reports' | 'complete'; processed: number; total: number; incompleteNotes: number; changedAt: string; errorCode?: 'collector_collection_failed' }
interface ImportOptions { db: DatabaseClient; runId: string; accountPlatformId: string }
interface ImportSummary { accountId: string; notesChanged: number; snapshotsChanged: number; commentsChanged: number; incompleteNotes: number; sha256: string }
interface Configuration { enabled: boolean; url: string; token: string; fetcher?: typeof fetch; importer?: (events: Iterable<unknown>, options: ImportOptions) => Promise<ImportSummary>; recorder?: (runId: string, summary: ImportSummary) => Promise<void>; db?: DatabaseClient; sleep?: (milliseconds: number) => Promise<void>; accountPlatformId?: string }

@Injectable()
export class LocalCollectorService {
  private readonly configuration: Configuration;
  private readonly imports = new Map<string, 'running' | 'completed' | 'failed'>();

  constructor(configuration?: Configuration) {
    this.configuration = configuration ?? {
      enabled: process.env.LOCAL_XHS_COLLECTOR_ENABLED === 'true',
      url: process.env.LOCAL_XHS_COLLECTOR_URL ?? 'http://127.0.0.1:43127',
      token: process.env.LOCAL_XHS_COLLECTOR_TOKEN ?? '',
    };
  }

  async startSync() {
    const status = await this.action('sync');
    if (status.runId && this.imports.get(status.runId) !== 'running') {
      this.imports.set(status.runId, 'running');
      void this.importRun(status.runId);
    }
    return status;
  }

  async syncStatus() {
    const status = await this.action('sync-status');
    if (!status.runId) return status;
    const imported = this.imports.get(status.runId);
    if (imported === 'failed') return { ...status, state: 'failed' as const, errorCode: 'collector_collection_failed' as const };
    if (status.state === 'completed' && imported === 'running') return { ...status, state: 'running' as const, stage: 'writing' as const };
    return status;
  }

  action(action: CollectorSessionAction): Promise<CollectorStatus>;
  action(action: CollectorCollectionAction): Promise<CollectorCollectionStatus>;
  async action(action: CollectorAction): Promise<CollectorStatus | CollectorCollectionStatus> {
    this.assertConfiguration();
    const routes: Record<CollectorAction, { path: string; method: 'GET' | 'POST'; response: 'session' | 'collection' }> = {
      start: { path: '/v1/session/start', method: 'POST', response: 'session' },
      status: { path: '/v1/session/status', method: 'GET', response: 'session' },
      refresh: { path: '/v1/session/refresh', method: 'POST', response: 'session' },
      close: { path: '/v1/session/close', method: 'POST', response: 'session' },
      sync: { path: '/v1/collection/start', method: 'POST', response: 'collection' },
      'sync-status': { path: '/v1/collection/status', method: 'GET', response: 'collection' },
    };
    const route = routes[action];
    if (!route) throw new Error('collector_action_invalid');
    const response = await (this.configuration.fetcher ?? fetch)(`${this.configuration.url}${route.path}`, {
      method: route.method, headers: { authorization: `Bearer ${this.configuration.token}` }, signal: AbortSignal.timeout(5_000),
    }).catch(() => { throw new ServiceUnavailableException('collector_unavailable'); });
    if (!response.ok) throw new ServiceUnavailableException('collector_unavailable');
    const body = await response.json().catch(() => null);
    if (route.response === 'session' ? !isCollectorStatus(body) : !isCollectionStatus(body)) throw new ServiceUnavailableException('collector_response_invalid');
    return body;
  }

  async qr(): Promise<CollectorQr> {
    this.assertConfiguration();
    const response = await (this.configuration.fetcher ?? fetch)(`${this.configuration.url}/v1/session/qr`, {
      method: 'GET', headers: { authorization: `Bearer ${this.configuration.token}` }, signal: AbortSignal.timeout(5_000),
    }).catch(() => { throw new ServiceUnavailableException('collector_unavailable'); });
    if (!response.ok) throw new ServiceUnavailableException('collector_unavailable');
    if (response.headers.get('content-type') !== 'image/png') throw new ServiceUnavailableException('collector_qr_content_type_invalid');
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > 1024 * 1024) throw new ServiceUnavailableException('collector_qr_too_large');
    const bytes = await readBoundedBytes(response, 1024 * 1024, 'collector_qr_too_large');
    if (!validQrPng(bytes)) throw new ServiceUnavailableException('collector_qr_invalid');
    const etag = response.headers.get('etag');
    const expires = response.headers.get('expires');
    if (!etag || !/^"[A-Za-z0-9_-]{1,128}"$/.test(etag) || !expires || !Number.isFinite(new Date(expires).getTime())) {
      throw new ServiceUnavailableException('collector_qr_metadata_invalid');
    }
    return { bytes, etag, expires };
  }

  private async importRun(runId: string) {
    try {
      let status: CollectorCollectionStatus | null = null;
      for (let attempt = 0; attempt < 240; attempt += 1) {
        status = await this.action('sync-status');
        if (status.runId !== runId) throw new Error('collector_run_changed');
        if (status.state === 'failed') throw new Error('collector_collection_failed');
        if (status.state === 'completed') break;
        await (this.configuration.sleep ?? delay)(500);
      }
      if (status?.state !== 'completed') throw new Error('collector_collection_timeout');
      const events = await this.events(runId);
      const importer = this.configuration.importer ?? importSelfScrapeCollection;
      const summary = await importer(events, { db: this.configuration.db ?? prisma, runId, accountPlatformId: this.configuration.accountPlatformId ?? process.env.LOCAL_XHS_ACCOUNT_PLATFORM_ID ?? 'local-creator' });
      await (this.configuration.recorder ?? ((id, value) => recordImport(this.configuration.db ?? prisma, id, value)))(runId, summary);
      this.imports.set(runId, 'completed');
    } catch {
      this.imports.set(runId, 'failed');
    }
  }

  private async events(runId: string) {
    this.assertConfiguration();
    const response = await (this.configuration.fetcher ?? fetch)(`${this.configuration.url}/v1/collection/events?runId=${encodeURIComponent(runId)}`, { method: 'GET', headers: { authorization: `Bearer ${this.configuration.token}` }, signal: AbortSignal.timeout(30_000) }).catch(() => { throw new ServiceUnavailableException('collector_unavailable'); });
    if (!response.ok) throw new ServiceUnavailableException('collector_unavailable');
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > 50 * 1024 * 1024) throw new ServiceUnavailableException('collector_events_too_large');
    const bytes = await readBoundedBytes(response, 50 * 1024 * 1024, 'collector_events_too_large');
    let body: unknown; try { body = JSON.parse(bytes.toString('utf8')); } catch { throw new ServiceUnavailableException('collector_response_invalid'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ServiceUnavailableException('collector_response_invalid');
    const value = body as Record<string, unknown>;
    if (Object.keys(value).some((key) => !['runId', 'events'].includes(key)) || value.runId !== runId || !Array.isArray(value.events) || value.events.length > 1_000_000) throw new ServiceUnavailableException('collector_response_invalid');
    return value.events;
  }

  private assertConfiguration() {
    if (!this.configuration.enabled) throw new ServiceUnavailableException('collector_disabled');
    const url = new URL(this.configuration.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) throw new ServiceUnavailableException('collector_loopback_required');
    if (Buffer.byteLength(this.configuration.token) < 32) throw new ServiceUnavailableException('collector_token_invalid');
  }
}

function isCollectionStatus(value: unknown): value is CollectorCollectionStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['runId', 'state', 'stage', 'processed', 'total', 'incompleteNotes', 'changedAt', 'errorCode'].includes(key))) return false;
  if (body.runId !== null && (typeof body.runId !== 'string' || body.runId.length < 1 || body.runId.length > 200)) return false;
  if (!['idle', 'running', 'completed', 'failed'].includes(String(body.state))) return false;
  if (!['account', 'notes', 'metrics', 'comments', 'replies', 'writing', 'reports', 'complete'].includes(String(body.stage))) return false;
  if (![body.processed, body.total, body.incompleteNotes].every((value) => Number.isSafeInteger(value) && Number(value) >= 0)) return false;
  if (typeof body.changedAt !== 'string' || !Number.isFinite(new Date(body.changedAt).getTime())) return false;
  return body.errorCode === undefined || body.errorCode === 'collector_collection_failed';
}

function isCollectorStatus(value: unknown): value is CollectorStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['state', 'changedAt', 'qrExpiresAt', 'errorCode'].includes(key))) return false;
  const changedAt = typeof body.changedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(body.changedAt) && Number.isFinite(new Date(body.changedAt).getTime());
  const qrExpiresAt = body.qrExpiresAt === undefined || typeof body.qrExpiresAt === 'string' && Number.isFinite(new Date(body.qrExpiresAt).getTime());
  return changedAt && qrExpiresAt && ['idle', 'launching', 'awaiting_scan', 'authenticated', 'verification_required', 'expired', 'closed', 'error'].includes(String(body.state)) && (body.errorCode === undefined || body.errorCode === 'collector_launch_failed');
}

async function readBoundedBytes(response: Response, maxBytes: number, code: string) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ServiceUnavailableException(code);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

function delay(milliseconds: number) { return new Promise<void>((resolve) => setTimeout(resolve, milliseconds)); }

async function recordImport(db: DatabaseClient, runId: string, summary: ImportSummary) {
  const now = new Date();
  const payload = { source: 'self-scrape', notesChanged: summary.notesChanged, snapshotsChanged: summary.snapshotsChanged, commentsChanged: summary.commentsChanged, incompleteNotes: summary.incompleteNotes, sha256: summary.sha256 };
  await db.$transaction(async (tx) => {
    await tx.syncJob.upsert({ where: { externalJobId: runId }, create: { externalJobId: runId, accountId: summary.accountId, status: 'succeeded', currentStage: 'complete', startedAt: now, completedAt: now, payload }, update: { status: 'succeeded', currentStage: 'complete', completedAt: now, error: null, payload } });
    await tx.notification.upsert({ where: { eventId: `self-scrape-sync:${runId}` }, create: { eventId: `self-scrape-sync:${runId}`, accountId: summary.accountId, type: 'sync_completed', title: '小红书数据同步完成', body: `已同步 ${summary.notesChanged} 条笔记变更、${summary.commentsChanged} 条评论变更`, link: '/dashboard' }, update: {} });
    await tx.auditLog.create({ data: { actor: 'local-collector', action: 'self_scrape.sync_succeeded', entityType: 'SelfScrapeCollectionRun', entityId: runId, details: payload } });
  });
}

function validQrPng(bytes: Buffer) {
  if (bytes.byteLength < 24 || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return false;
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return false;
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 && width <= 1024 && height <= 1024;
}
