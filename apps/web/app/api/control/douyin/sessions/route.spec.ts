import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: cookieGet }) }));

import { GET, POST } from './route';

describe('Douyin session collection BFF', () => {
  beforeEach(() => { cookieGet.mockReset(); cookieGet.mockImplementation((name: string) => ({ value: name === 'admin_session' ? 'admin-session' : 'csrf-token' })); });

  it('lists sessions with the admin cookie', async () => {
    const fetcher = vi.fn(async () => Response.json({ items: [] })); vi.stubGlobal('fetch', fetcher);
    expect((await GET()).status).toBe(200);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/douyin-local/sessions'), expect.objectContaining({ cache: 'no-store' }));
  });

  it('creates a session through the same-origin mutation guard', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', state: 'launching' }, { status: 201 })));
    const response = await POST(new Request('http://127.0.0.1:3000/api/control/douyin/sessions', { method: 'POST', headers: { origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: '{}' }));
    expect(response.status).toBe(201);
  });
});
