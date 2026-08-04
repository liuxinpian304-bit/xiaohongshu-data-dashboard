import { describe, expect, it, vi } from 'vitest';

import { LocalCollectorController } from './local-collector.controller';

describe('LocalCollectorController', () => {
  it('exposes explicit session and collection actions', async () => {
    const action = vi.fn(async (name: string) => ({ action: name }));
    const controller = new LocalCollectorController({ action, startSync: async () => ({ action: 'sync' }), syncStatus: async () => ({ action: 'sync-status' }) } as any);

    await expect(controller.start()).resolves.toEqual({ action: 'start' });
    await expect(controller.refresh()).resolves.toEqual({ action: 'refresh' });
    await expect(controller.close()).resolves.toEqual({ action: 'close' });
    await expect(controller.sync()).resolves.toEqual({ action: 'sync' });
    await expect(controller.syncStatus()).resolves.toEqual({ action: 'sync-status' });
  });

  it('writes a private no-store PNG response', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const headers: Record<string, string | number> = {};
    let body: Buffer | undefined;
    const response = {
      setHeader: (name: string, value: string | number) => { headers[name.toLowerCase()] = value; },
      end: (value: Buffer) => { body = value; },
    };
    const controller = new LocalCollectorController({
      qr: async () => ({ bytes: png, etag: '"qr-etag"', expires: '2026-08-04T00:02:00.000Z' }),
    } as any);

    await controller.qr(response as any);

    expect(headers).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      etag: '"qr-etag"',
    });
    expect(body).toEqual(png);
  });
});
