import { describe, expect, it } from 'vitest';

import { requestJson } from './api';

describe('requestJson', () => {
  it('keeps an authenticated successful empty response as success', async () => {
    const result = await requestJson<{ items: unknown[] }>('/resource', undefined, async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));

    expect(result).toEqual({ status: 'ok', data: { items: [] } });
  });

  it('classifies authentication failures separately from service errors', async () => {
    const unauthorized = await requestJson('/resource', undefined, async () => new Response('{}', { status: 401 }));
    const unavailable = await requestJson('/resource', undefined, async () => new Response('{}', { status: 503 }));

    expect(unauthorized).toEqual({ status: 'unauthorized' });
    expect(unavailable).toEqual({ status: 'error', kind: 'server', message: '服务暂时不可用' });
  });

  it('distinguishes network and malformed response failures', async () => {
    const network = await requestJson('/resource', undefined, async () => { throw new TypeError('offline'); });
    const malformed = await requestJson('/resource', undefined, async () => new Response('not-json', { status: 200 }));

    expect(network).toMatchObject({ status: 'error', kind: 'network' });
    expect(malformed).toMatchObject({ status: 'error', kind: 'parse' });
  });
});
