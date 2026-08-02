import { describe, expect, it } from 'vitest';

import { collectCursorPages, requestJson } from './api';

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

  it('collects every authorized account page instead of stopping at 200', async () => {
    const pages = [Array.from({ length: 200 }, (_, id) => id), Array.from({ length: 5 }, (_, id) => id + 200)];
    const result = await collectCursorPages(async (cursor) => ({ status: 'ok', data: { items: pages[cursor ? 1 : 0]!, pageInfo: { hasMore: !cursor, nextCursor: cursor ? null : 'page-2' } } }));
    expect(result.status === 'ok' && result.data.items).toHaveLength(205);
  });

  it('fails closed for a missing pagination cursor', async () => {
    const result = await collectCursorPages(async () => ({ status: 'ok', data: { items: [], pageInfo: { hasMore: true, nextCursor: null } } }));
    expect(result).toMatchObject({ status: 'error', message: '账号分页游标无效，请刷新后重试' });
  });

  it('fails closed for a repeated pagination cursor', async () => {
    const result = await collectCursorPages(async () => ({ status: 'ok', data: { items: [], pageInfo: { hasMore: true, nextCursor: 'same' } } }));
    expect(result).toMatchObject({ status: 'error', message: '账号分页游标无效，请刷新后重试' });
  });
});
