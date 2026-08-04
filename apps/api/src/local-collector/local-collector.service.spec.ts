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
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ state: 'awaiting_scan', changedAt: '2026-08-04T00:00:00.000Z', qrExpiresAt: '2026-08-04T00:02:00.000Z' }), { status: 200 }));
    const service = new LocalCollectorService({ enabled: true, url: 'http://127.0.0.1:43127', token, fetcher });
    await expect(service.action('start')).resolves.toMatchObject({ state: 'awaiting_scan' });
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:43127/v1/session/start', expect.objectContaining({ method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: expect.any(AbortSignal) }));
    await expect(service.action('cookies' as never)).rejects.toThrow('collector_action_invalid');
  });

  it('maps timeout and upstream errors without returning upstream bodies', async () => {
    const fetcher = vi.fn(async () => new Response('secret upstream error', { status: 500 }));
    const service = new LocalCollectorService({ enabled: true, url: 'http://127.0.0.1:43127', token, fetcher });
    await expect(service.action('status')).rejects.toThrow('collector_unavailable');
  });

  it('validates collection progress through fixed sync actions', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      runId: 'run-1', state: 'running', stage: 'comments', processed: 7,
      total: 10, incompleteNotes: 1, changedAt: '2026-08-04T00:00:00.000Z',
    }), { status: 200 }));
    const service = new LocalCollectorService({ enabled: true, url: 'http://127.0.0.1:43127', token, fetcher });

    await expect(service.action('sync')).resolves.toMatchObject({ runId: 'run-1', stage: 'comments', processed: 7 });
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:43127/v1/collection/start', expect.objectContaining({ method: 'POST' }));
  });

  it('accepts only bounded PNG QR responses', async () => {
    const png = pngFixture(320, 320);
    const fetcher = vi.fn(async () => new Response(png, {
      status: 200,
      headers: { 'content-type': 'image/png', etag: '"qr-etag"', expires: '2026-08-04T00:02:00.000Z' },
    }));
    const service = new LocalCollectorService({ enabled: true, url: 'http://127.0.0.1:43127', token, fetcher });

    await expect(service.qr()).resolves.toMatchObject({ bytes: png, etag: '"qr-etag"', expires: '2026-08-04T00:02:00.000Z' });
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:43127/v1/session/qr', expect.objectContaining({
      method: 'GET', headers: { authorization: `Bearer ${token}` }, signal: expect.any(AbortSignal),
    }));
  });

  it.each([
    ['text/html', pngFixture(320, 320), 'collector_qr_content_type_invalid'],
    ['image/png', Buffer.alloc(1024 * 1024 + 1), 'collector_qr_too_large'],
    ['image/png', Buffer.from('<html>'), 'collector_qr_invalid'],
  ])('rejects invalid QR response %s', async (contentType, body, code) => {
    const fetcher = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': contentType, etag: '"qr-etag"', expires: '2026-08-04T00:02:00.000Z' } }));
    const service = new LocalCollectorService({ enabled: true, url: 'http://127.0.0.1:43127', token, fetcher });

    await expect(service.qr()).rejects.toThrow(code);
  });
});

function pngFixture(width: number, height: number) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
