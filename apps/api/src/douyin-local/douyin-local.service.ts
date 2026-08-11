import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { importPlatformCollection, prisma, type DatabaseClient, type PlatformImportSummary } from '@xhs/database';

export type DouyinSessionState = 'idle' | 'launching' | 'awaiting_scan' | 'authenticated' | 'verification_required' | 'expired' | 'error' | 'closed';
export interface DouyinIdentity { platformId: string; douyinAccountId: string; displayName: string; avatarUrl: string | null }
export interface DouyinSessionStatus { sessionId: string; state: DouyinSessionState; changedAt: string; identity?: DouyinIdentity; identityVerifiedAt?: string; qrExpiresAt?: string }
export interface DouyinCollectionStatus { runId: string | null; state: 'idle' | 'running' | 'completed' | 'failed'; stage: 'account' | 'notes' | 'metrics' | 'comments' | 'replies' | 'writing' | 'reports' | 'complete'; processed: number; total: number; incompleteNotes: number; changedAt: string; errorCode?: 'collector_collection_failed' }

interface Configuration { enabled: boolean; url: string; token: string; fetcher?: typeof fetch; db?: DatabaseClient; importer?: (events: Iterable<unknown>, options: { db: DatabaseClient; platform: 'douyin'; source: 'self-scrape'; accountPlatformId: string; runId: string }) => Promise<PlatformImportSummary | Omit<PlatformImportSummary, 'platform' | 'source'>>; sleep?: (milliseconds: number) => Promise<void> }

@Injectable()
export class DouyinLocalService {
  private readonly configuration: Configuration;
  private readonly imports = new Map<string, 'running' | 'completed' | 'failed'>();
  private readonly runIdentities = new Map<string, string>();

  constructor(configuration?: Configuration) {
    this.configuration = configuration ?? {
      enabled: process.env.LOCAL_XHS_COLLECTOR_ENABLED === 'true',
      url: process.env.LOCAL_XHS_COLLECTOR_URL ?? 'http://127.0.0.1:43127',
      token: process.env.LOCAL_XHS_COLLECTOR_TOKEN ?? '',
    };
  }

  async create() { return this.requestStatus('/v3/douyin/sessions', 'POST'); }

  async list() {
    const body = await this.request('/v3/douyin/sessions', 'GET');
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'items')) this.invalid();
    const items = (body as Record<string, unknown>).items;
    if (!Array.isArray(items) || items.length > 100) this.invalid();
    const statuses = items.map(validateStatus);
    for (const status of statuses) await this.bindIfVerified(status);
    return { items: statuses };
  }

  async status(sessionId: string) { return this.requestStatus(`/v3/douyin/sessions/${validSessionId(sessionId)}`, 'GET'); }
  async refresh(sessionId: string) { return this.requestStatus(`/v3/douyin/sessions/${validSessionId(sessionId)}/refresh`, 'POST'); }
  async close(sessionId: string) { return this.requestStatus(`/v3/douyin/sessions/${validSessionId(sessionId)}`, 'DELETE'); }

  async startCollection(sessionId: string) {
    const id = validSessionId(sessionId);
    const session = await this.requestStatus(`/v3/douyin/sessions/${id}`, 'GET');
    if (session.state !== 'authenticated' || !session.identity) throw new ServiceUnavailableException('douyin_identity_unavailable');
    const status = validateCollectionStatus(await this.request(`/v3/douyin/sessions/${id}/collection/start`, 'POST'));
    if (status.runId && this.imports.get(status.runId) !== 'running') {
      this.imports.set(status.runId, 'running'); this.runIdentities.set(status.runId, session.identity.platformId);
      void this.importRun(id, status.runId);
    }
    return status;
  }

  async collectionStatus(sessionId: string) {
    const status = validateCollectionStatus(await this.request(`/v3/douyin/sessions/${validSessionId(sessionId)}/collection/status`, 'GET'));
    if (!status.runId) return status;
    const imported = this.imports.get(status.runId);
    if (imported === 'failed') return { ...status, state: 'failed' as const, errorCode: 'collector_collection_failed' as const };
    if (status.state === 'completed' && imported === 'running') return { ...status, state: 'running' as const, stage: 'writing' as const };
    return status;
  }

  async qr(sessionId: string) {
    const response = await this.fetch(`/v3/douyin/sessions/${validSessionId(sessionId)}/qr`, 'GET');
    if (response.headers.get('content-type') !== 'image/png') throw new ServiceUnavailableException('invalid_douyin_qr');
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > 1024 * 1024) throw new ServiceUnavailableException('invalid_douyin_qr');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > 1024 * 1024 || bytes.byteLength < 8 || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new ServiceUnavailableException('invalid_douyin_qr');
    return { bytes, expires: response.headers.get('expires') };
  }

  private async requestStatus(path: string, method: 'GET' | 'POST' | 'DELETE') {
    const status = validateStatus(await this.request(path, method));
    await this.bindIfVerified(status);
    return status;
  }

  private async importRun(sessionId: string, runId: string) {
    try {
      let status: DouyinCollectionStatus | null = null;
      for (let attempt = 0; attempt < 240; attempt += 1) {
        status = validateCollectionStatus(await this.request(`/v3/douyin/sessions/${sessionId}/collection/status`, 'GET'));
        if (status.runId !== runId || status.state === 'failed') throw new Error('douyin_collection_failed');
        if (status.state === 'completed') break;
        await (this.configuration.sleep ?? delay)(500);
      }
      if (status?.state !== 'completed') throw new Error('douyin_collection_timeout');
      const body = await this.request(`/v3/douyin/sessions/${sessionId}/collection/events?runId=${encodeURIComponent(runId)}`, 'GET');
      if (!body || typeof body !== 'object' || Array.isArray(body)) this.invalid();
      const envelope = body as Record<string, unknown>;
      if (envelope.runId !== runId || !Array.isArray(envelope.events) || envelope.events.length > 1_000_000) this.invalid();
      const accountPlatformId = this.runIdentities.get(runId); if (!accountPlatformId) throw new Error('douyin_identity_unavailable');
      const importer = this.configuration.importer ?? importPlatformCollection;
      await importer(envelope.events, { db: this.configuration.db ?? prisma, platform: 'douyin', source: 'self-scrape', accountPlatformId, runId });
      this.imports.set(runId, 'completed');
    } catch { this.imports.set(runId, 'failed'); }
    finally { this.runIdentities.delete(runId); }
  }

  private async bindIfVerified(status: DouyinSessionStatus) {
    if (status.state !== 'authenticated' || !status.identity || !status.identityVerifiedAt) return;
    const identity = status.identity;
    const data = { platform: 'douyin', source: 'self-scrape', connectorType: 'douyin-local', platformId: identity.platformId, xhsAccountId: identity.douyinAccountId, displayName: identity.displayName, avatarUrl: identity.avatarUrl, identityVerifiedAt: new Date(status.identityVerifiedAt) };
    await (this.configuration.db ?? prisma).account.upsert({
      where: { connectorType_platformId: { connectorType: 'douyin-local', platformId: identity.platformId } },
      create: data,
      update: { xhsAccountId: identity.douyinAccountId, displayName: identity.displayName, avatarUrl: identity.avatarUrl, identityVerifiedAt: data.identityVerifiedAt, source: 'self-scrape', platform: 'douyin' },
    });
  }

  private async request(path: string, method: 'GET' | 'POST' | 'DELETE') {
    const response = await this.fetch(path, method);
    return response.json().catch(() => this.invalid());
  }

  private async fetch(path: string, method: 'GET' | 'POST' | 'DELETE') {
    this.assertConfiguration();
    const response = await (this.configuration.fetcher ?? fetch)(`${this.configuration.url}${path}`, { method, headers: { authorization: `Bearer ${this.configuration.token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => { throw new ServiceUnavailableException('douyin_collector_unavailable'); });
    if (!response.ok) throw new ServiceUnavailableException('douyin_collector_unavailable');
    return response;
  }

  private assertConfiguration() {
    if (!this.configuration.enabled) throw new ServiceUnavailableException('douyin_collector_disabled');
    const url = new URL(this.configuration.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) throw new ServiceUnavailableException('douyin_collector_loopback_required');
    if (Buffer.byteLength(this.configuration.token) < 32) throw new ServiceUnavailableException('douyin_collector_token_invalid');
  }

  private invalid(): never { throw new ServiceUnavailableException('invalid_douyin_collector_response'); }
}

function validateStatus(value: unknown): DouyinSessionStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['sessionId', 'state', 'changedAt', 'identity', 'identityVerifiedAt', 'qrExpiresAt'].includes(key))) invalid();
  const sessionId = validSessionId(body.sessionId);
  if (!['idle', 'launching', 'awaiting_scan', 'authenticated', 'verification_required', 'expired', 'error', 'closed'].includes(String(body.state))) invalid();
  if (!date(body.changedAt) || body.identityVerifiedAt !== undefined && !date(body.identityVerifiedAt) || body.qrExpiresAt !== undefined && !date(body.qrExpiresAt)) invalid();
  const identity = body.identity === undefined ? undefined : validateIdentity(body.identity);
  if (body.state === 'authenticated' && (!identity || !body.identityVerifiedAt)) invalid();
  return { sessionId, state: body.state as DouyinSessionState, changedAt: String(body.changedAt), ...(identity ? { identity } : {}), ...(body.identityVerifiedAt ? { identityVerifiedAt: String(body.identityVerifiedAt) } : {}), ...(body.qrExpiresAt ? { qrExpiresAt: String(body.qrExpiresAt) } : {}) };
}

function validateIdentity(value: unknown): DouyinIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['platformId', 'douyinAccountId', 'displayName', 'avatarUrl'].includes(key))) invalid();
  if (!/^douyin:[A-Za-z0-9_-]{1,190}$/.test(String(body.platformId)) || !text(body.douyinAccountId) || !text(body.displayName) || body.avatarUrl !== null && !https(body.avatarUrl)) invalid();
  return { platformId: String(body.platformId), douyinAccountId: String(body.douyinAccountId), displayName: String(body.displayName), avatarUrl: body.avatarUrl === null ? null : String(body.avatarUrl) };
}

function validateCollectionStatus(value: unknown): DouyinCollectionStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['runId', 'state', 'stage', 'processed', 'total', 'incompleteNotes', 'changedAt', 'errorCode'].includes(key))) invalid();
  if (body.runId !== null && (typeof body.runId !== 'string' || body.runId.length < 1 || body.runId.length > 200)) invalid();
  if (!['idle', 'running', 'completed', 'failed'].includes(String(body.state)) || !['account', 'notes', 'metrics', 'comments', 'replies', 'writing', 'reports', 'complete'].includes(String(body.stage))) invalid();
  if (![body.processed, body.total, body.incompleteNotes].every((item) => Number.isSafeInteger(item) && Number(item) >= 0) || !date(body.changedAt)) invalid();
  if (body.errorCode !== undefined && body.errorCode !== 'collector_collection_failed') invalid();
  return body as unknown as DouyinCollectionStatus;
}

function validSessionId(value: unknown) { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) invalid(); return value; }
function text(value: unknown) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 200; }
function date(value: unknown) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function https(value: unknown) { if (typeof value !== 'string' || value.length > 2048) return false; try { return new URL(value).protocol === 'https:'; } catch { return false; } }
function invalid(): never { throw new ServiceUnavailableException('invalid_douyin_collector_response'); }
function delay(milliseconds: number) { return new Promise<void>((resolve) => setTimeout(resolve, milliseconds)); }
