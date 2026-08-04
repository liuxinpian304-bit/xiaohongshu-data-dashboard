import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export type CollectorSessionAction = 'start' | 'status' | 'refresh' | 'close';
export type CollectorCollectionAction = 'sync' | 'sync-status';
export type CollectorAction = CollectorSessionAction | CollectorCollectionAction;
export interface CollectorStatus { state: 'idle' | 'launching' | 'awaiting_scan' | 'authenticated' | 'verification_required' | 'expired' | 'closed' | 'error'; changedAt: string; qrExpiresAt?: string; errorCode?: string }
export interface CollectorQr { bytes: Buffer; etag: string; expires: string }
export interface CollectorCollectionStatus { runId: string | null; state: 'idle' | 'running' | 'completed' | 'failed'; stage: 'account' | 'notes' | 'metrics' | 'comments' | 'replies' | 'writing' | 'reports' | 'complete'; processed: number; total: number; incompleteNotes: number; changedAt: string; errorCode?: 'collector_collection_failed' }
interface Configuration { enabled: boolean; url: string; token: string; fetcher?: typeof fetch }

@Injectable()
export class LocalCollectorService {
  private readonly configuration: Configuration;

  constructor(configuration?: Configuration) {
    this.configuration = configuration ?? {
      enabled: process.env.LOCAL_XHS_COLLECTOR_ENABLED === 'true',
      url: process.env.LOCAL_XHS_COLLECTOR_URL ?? 'http://127.0.0.1:43127',
      token: process.env.LOCAL_XHS_COLLECTOR_TOKEN ?? '',
    };
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
    const bytes = await readBoundedBody(response, 1024 * 1024);
    if (!validQrPng(bytes)) throw new ServiceUnavailableException('collector_qr_invalid');
    const etag = response.headers.get('etag');
    const expires = response.headers.get('expires');
    if (!etag || !/^"[A-Za-z0-9_-]{1,128}"$/.test(etag) || !expires || !Number.isFinite(new Date(expires).getTime())) {
      throw new ServiceUnavailableException('collector_qr_metadata_invalid');
    }
    return { bytes, etag, expires };
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

async function readBoundedBody(response: Response, maxBytes: number) {
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
      throw new ServiceUnavailableException('collector_qr_too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

function validQrPng(bytes: Buffer) {
  if (bytes.byteLength < 24 || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return false;
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return false;
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 && width <= 1024 && height <= 1024;
}
