import { describe, expect, it, vi } from 'vitest';

import { LocalCollectorService } from './local-collector.service';

const token = 'b'.repeat(48);

describe('LocalCollectorService', () => {
  it('fails closed when disabled, tokenless, or configured off loopback without stopping API construction', async () => {
    await expect(new LocalCollectorService({ enabled: false, url: 'http://127.0.0.1:43127', token }).action('status')).rejects.toThrow('collector_disabled');
    await expect(new LocalCollectorService({ enabled: true, url: 'http://localhost:43127', token }).action('status')).rejects.toThrow('collector_loopback_required');
    await expect(new LocalCollectorService({ enabled: true, url: 'http://127.0.0.1:43127', token: '' }).action('status')).rejects.toThrow('collector_token_invalid');
  });

  it('calls only allowlisted actions with the server-only bearer token', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ state: 'browser_open', changedAt: '2026-08-04T00:00:00.000Z' }), { status: 200 }));
    const service = new LocalCollectorService({ enabled: true, url: 'http://127.0.0.1:43127', token, fetcher });
    await expect(service.action('start')).resolves.toMatchObject({ state: 'browser_open' });
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:43127/v1/session/start', expect.objectContaining({ method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: expect.any(AbortSignal) }));
    await expect(service.action('cookies' as never)).rejects.toThrow('collector_action_invalid');
  });

  it('maps timeout and upstream errors without returning upstream bodies', async () => {
    const fetcher = vi.fn(async () => new Response('secret upstream error', { status: 500 }));
    const service = new LocalCollectorService({ enabled: true, url: 'http://127.0.0.1:43127', token, fetcher });
    await expect(service.action('status')).rejects.toThrow('collector_unavailable');
  });
});
