import { request } from 'node:http';
import { describe, expect, it } from 'vitest';

import { createCollectorServer, validateCollectorConfiguration } from './server';

const token = 'a'.repeat(48);

describe('collector server', () => {
  it('rejects disabled, non-loopback and weak-token configurations', () => {
    expect(() => validateCollectorConfiguration({ enabled: false, host: '127.0.0.1', token })).toThrow('collector_disabled');
    expect(() => validateCollectorConfiguration({ enabled: true, host: '0.0.0.0', token })).toThrow('collector_loopback_required');
    expect(() => validateCollectorConfiguration({ enabled: true, host: '127.0.0.1', token: 'short' })).toThrow('collector_token_invalid');
  });

  it('requires bearer auth and exposes only allowlisted session actions', async () => {
    const png = pngFixture(320, 320);
    const manager = {
      status: () => ({ state: 'idle' as const, changedAt: '2026-08-04T00:00:00.000Z' }),
      start: async () => ({ state: 'awaiting_scan' as const, changedAt: '2026-08-04T00:00:01.000Z', qrExpiresAt: '2026-08-04T00:02:01.000Z' }),
      refresh: async () => ({ state: 'authenticated' as const, changedAt: '2026-08-04T00:00:02.000Z' }),
      qr: () => ({ bytes: png, contentType: 'image/png' as const, expiresAt: '2026-08-04T00:02:01.000Z', etag: '"qr-etag"' }),
      confirm: () => ({ state: 'user_confirmed' as const, changedAt: '2026-08-04T00:00:02.000Z' }),
      close: async () => ({ state: 'closed' as const, changedAt: '2026-08-04T00:00:03.000Z' }),
    };
    const collection = {
      start: () => ({ runId: 'run-1', state: 'running' as const, stage: 'account' as const, processed: 0, total: 0, incompleteNotes: 0, changedAt: '2026-08-04T00:00:04.000Z' }),
      status: () => ({ runId: 'run-1', state: 'running' as const, stage: 'notes' as const, processed: 2, total: 8, incompleteNotes: 0, changedAt: '2026-08-04T00:00:05.000Z' }),
    };
    const server = createCollectorServer({ token, manager, collection });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    try {
      expect(await call(address.port, 'GET', '/v1/session/status')).toMatchObject({ status: 401 });
      expect(await call(address.port, 'POST', '/v1/session/start', token)).toMatchObject({ status: 200, body: { state: 'awaiting_scan', changedAt: expect.any(String) } });
      expect(await call(address.port, 'POST', '/v1/session/refresh', token)).toMatchObject({ status: 200, body: { state: 'authenticated', changedAt: expect.any(String) } });
      expect(await callRaw(address.port, 'GET', '/v1/session/qr', token)).toMatchObject({
        status: 200,
        body: png,
        headers: { 'content-type': 'image/png', 'cache-control': 'no-store', etag: '"qr-etag"' },
      });
      expect(await call(address.port, 'POST', '/v1/session/confirm', token)).toMatchObject({ status: 404 });
      expect(await call(address.port, 'POST', '/v1/session/close', token)).toMatchObject({ status: 200, body: { state: 'closed', changedAt: expect.any(String) } });
      expect(await call(address.port, 'POST', '/v1/collection/start', token)).toMatchObject({ status: 202, body: { runId: 'run-1', state: 'running', stage: 'account' } });
      expect(await call(address.port, 'GET', '/v1/collection/status', token)).toMatchObject({ status: 200, body: { runId: 'run-1', state: 'running', stage: 'notes', processed: 2 } });
      expect(await call(address.port, 'GET', '/v1/session/cookies', token)).toMatchObject({ status: 404 });
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });
});

function call(port: number, method: string, path: string, bearer?: string) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: bearer ? { authorization: `Bearer ${bearer}` } : {} }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject); req.end();
  });
}

function callRaw(port: number, method: string, path: string, bearer?: string) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: bearer ? { authorization: `Bearer ${bearer}` } : {} }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
}

function pngFixture(width: number, height: number) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
