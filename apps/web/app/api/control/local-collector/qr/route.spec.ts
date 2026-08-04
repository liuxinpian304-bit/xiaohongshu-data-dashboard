import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: cookieGet }) }));

import { GET } from './route';

describe('local collector QR BFF', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    cookieGet.mockReturnValue({ value: 'admin-session' });
  });

  it('forwards only the authenticated PNG response without caching', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(png, {
      status: 200,
      headers: { 'content-type': 'image/png', etag: '"qr-etag"', expires: '2026-08-04T00:02:00.000Z' },
    })));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  });
});
