import { createServer, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LocalXhsSessionManager, type SessionStatus } from './session-manager';

interface CollectorConfiguration { enabled: boolean; host: string; token: string }
interface SessionManagerLike {
  status(): SessionStatus;
  start(): Promise<SessionStatus>;
  confirm(): SessionStatus;
  close(): Promise<SessionStatus>;
}

export function validateCollectorConfiguration(configuration: CollectorConfiguration) {
  if (!configuration.enabled) throw new Error('collector_disabled');
  if (configuration.host !== '127.0.0.1') throw new Error('collector_loopback_required');
  if (Buffer.byteLength(configuration.token) < 32) throw new Error('collector_token_invalid');
  return configuration;
}

export function createCollectorServer(options: { token: string; manager: SessionManagerLike }): Server {
  return createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    if (!authorized(request.headers.authorization, options.token)) return send(response, 401, { error: 'unauthorized' });
    const route = `${request.method} ${request.url}`;
    try {
      if (route === 'GET /v1/session/status') return send(response, 200, options.manager.status());
      if (route === 'POST /v1/session/start') return send(response, 200, await options.manager.start());
      if (route === 'POST /v1/session/confirm') return send(response, 200, options.manager.confirm());
      if (route === 'POST /v1/session/close') return send(response, 200, await options.manager.close());
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

async function main() {
  const configuration = validateCollectorConfiguration({
    enabled: process.env.LOCAL_XHS_COLLECTOR_ENABLED === 'true',
    host: process.env.LOCAL_XHS_COLLECTOR_HOST ?? '127.0.0.1',
    token: process.env.LOCAL_XHS_COLLECTOR_TOKEN ?? '',
  });
  const profileDirectory = process.env.LOCAL_XHS_PROFILE_DIR ?? join(homedir(), 'Library', 'Application Support', 'xiaohongshu-dashboard', 'collector-profile');
  const manager = new LocalXhsSessionManager({ profileDirectory });
  const server = createCollectorServer({ token: configuration.token, manager });
  const close = async () => { await manager.close(); server.close(); };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  server.listen(Number(process.env.LOCAL_XHS_COLLECTOR_PORT ?? 43127), configuration.host);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
