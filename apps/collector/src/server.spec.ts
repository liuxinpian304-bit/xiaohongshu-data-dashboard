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
    const manager = {
      status: () => ({ state: 'idle' as const, changedAt: '2026-08-04T00:00:00.000Z' }),
      start: async () => ({ state: 'browser_open' as const, changedAt: '2026-08-04T00:00:01.000Z' }),
      confirm: () => ({ state: 'user_confirmed' as const, changedAt: '2026-08-04T00:00:02.000Z' }),
      close: async () => ({ state: 'closed' as const, changedAt: '2026-08-04T00:00:03.000Z' }),
    };
    const server = createCollectorServer({ token, manager });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    try {
      expect(await call(address.port, 'GET', '/v1/session/status')).toMatchObject({ status: 401 });
      expect(await call(address.port, 'POST', '/v1/session/start', token)).toMatchObject({ status: 200, body: { state: 'browser_open', changedAt: expect.any(String) } });
      expect(await call(address.port, 'POST', '/v1/session/confirm', token)).toMatchObject({ status: 200, body: { state: 'user_confirmed', changedAt: expect.any(String) } });
      expect(await call(address.port, 'POST', '/v1/session/close', token)).toMatchObject({ status: 200, body: { state: 'closed', changedAt: expect.any(String) } });
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
