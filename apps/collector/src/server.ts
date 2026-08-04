import { createServer, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CollectionRun, type CollectionProgress, type CollectionStatus } from './collection-run';
import { LocalXhsSessionManager, type QrSnapshot, type SessionStatus } from './session-manager';

interface CollectorConfiguration { enabled: boolean; host: string; token: string }
interface SessionManagerLike {
  status(): SessionStatus;
  start(): Promise<SessionStatus>;
  refresh(): Promise<SessionStatus>;
  qr(): QrSnapshot;
  close(): Promise<SessionStatus>;
}
interface CollectionRunLike { start(): CollectionStatus; status(): CollectionStatus; events?(runId: string): unknown[] }

export function validateCollectorConfiguration(configuration: CollectorConfiguration) {
  if (!configuration.enabled) throw new Error('collector_disabled');
  if (configuration.host !== '127.0.0.1') throw new Error('collector_loopback_required');
  if (Buffer.byteLength(configuration.token) < 32) throw new Error('collector_token_invalid');
  return configuration;
}

export function createRuntimeCollection<TEvent>(manager: {
  collect(progress: (value: CollectionProgress) => void, emit: (event: TEvent) => void, runId: string): Promise<void>;
}) {
  return new CollectionRun<TEvent>({ collect: (progress, emit, runId) => manager.collect(progress, emit, runId) });
}

export function createCollectorServer(options: { token: string; manager: SessionManagerLike; collection: CollectionRunLike }): Server {
  return createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    if (!authorized(request.headers.authorization, options.token)) return send(response, 401, { error: 'unauthorized' });
    const parsedUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    const route = `${request.method} ${parsedUrl.pathname}`;
    try {
      if (route === 'GET /v1/session/status') return send(response, 200, options.manager.status());
      if (route === 'POST /v1/session/start') return send(response, 200, await options.manager.start());
      if (route === 'POST /v1/session/refresh') return send(response, 200, await options.manager.refresh());
      if (route === 'GET /v1/session/qr') return sendQr(response, options.manager.qr());
      if (route === 'POST /v1/session/close') return send(response, 200, await options.manager.close());
      if (route === 'POST /v1/collection/start') return send(response, 202, options.collection.start());
      if (route === 'GET /v1/collection/status') return send(response, 200, options.collection.status());
      if (route === 'GET /v1/collection/events') {
        const runId = parsedUrl.searchParams.get('runId');
        if (!runId || runId.length > 200 || [...parsedUrl.searchParams.keys()].some((key) => key !== 'runId')) return send(response, 400, { error: 'invalid_request' });
        if (!options.collection.events) return send(response, 409, { error: 'collector_events_unavailable' });
        return send(response, 200, { runId, events: options.collection.events(runId) });
      }
      return send(response, 404, { error: 'not_found' });
    } catch (error) {
      const code = error instanceof Error && /^collector_[a-z_]+$/.test(error.message) ? error.message : 'collector_operation_failed';
      return send(response, 409, { error: code });
    }
  });
}

function authorized(header: string | undefined, expected: string) {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const target = Buffer.from(expected);
  return supplied.byteLength === target.byteLength && timingSafeEqual(supplied, target);
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

function sendQr(response: ServerResponse, snapshot: QrSnapshot) {
  response.statusCode = 200;
  response.setHeader('content-type', snapshot.contentType);
  response.setHeader('content-length', snapshot.bytes.byteLength);
  response.setHeader('cache-control', 'no-store');
  response.setHeader('etag', snapshot.etag);
  response.setHeader('expires', snapshot.expiresAt);
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(snapshot.bytes);
}

async function main() {
  const configuration = validateCollectorConfiguration({
    enabled: process.env.LOCAL_XHS_COLLECTOR_ENABLED === 'true',
    host: process.env.LOCAL_XHS_COLLECTOR_HOST ?? '127.0.0.1',
    token: process.env.LOCAL_XHS_COLLECTOR_TOKEN ?? '',
  });
  const profileDirectory = process.env.LOCAL_XHS_PROFILE_DIR ?? join(homedir(), 'Library', 'Application Support', 'xiaohongshu-dashboard', 'collector-profile');
  const manager = new LocalXhsSessionManager({ profileDirectory });
  const collection = createRuntimeCollection(manager);
  const server = createCollectorServer({ token: configuration.token, manager, collection });
  const close = async () => { await manager.close(); server.close(); };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  server.listen(Number(process.env.LOCAL_XHS_COLLECTOR_PORT ?? 43127), configuration.host);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
