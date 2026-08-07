import { describe, expect, it, vi } from 'vitest';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  it('returns only safe health and account fields', async () => {
    const service = new SettingsService(
      { $queryRaw: vi.fn(async () => [{ ok: 1 }]) } as never,
      { action: vi.fn(async () => ({ state: 'authenticated', changedAt: '2026-08-07T02:07:07.889Z', identityVerifiedAt: '2026-08-07T02:07:07.889Z', identity: { platformId: 'stable-id', xhsAccountId: '95874286519', displayName: '南瓜汤与瓜子仁', avatarUrl: null } })) } as never,
    );

    const result = await service.status();

    expect(result).toMatchObject({ api: 'healthy', database: 'healthy', collector: 'healthy', timezone: 'Asia/Shanghai', account: { displayName: '南瓜汤与瓜子仁', xhsAccountId: '95874286519' } });
    expect(JSON.stringify(result)).not.toMatch(/token|password|cookie|databaseUrl|filePath/i);
  });

  it('keeps the page usable when database and collector checks fail', async () => {
    const service = new SettingsService(
      { $queryRaw: vi.fn(async () => { throw new Error('database secret'); }) } as never,
      { action: vi.fn(async () => { throw new Error('collector secret'); }) } as never,
    );

    await expect(service.status()).resolves.toMatchObject({ api: 'healthy', database: 'unhealthy', collector: 'unhealthy', account: null });
  });
});
