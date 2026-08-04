import { describe, expect, it, vi } from 'vitest';

import { XhsPageAdapter } from './xhs-page-adapter';

describe('XhsPageAdapter', () => {
  it('recognizes an authenticated creator page from visible creator navigation', async () => {
    const page = fakePage({
      url: 'https://creator.xiaohongshu.com/publish/publish',
      visibleSelectors: ['text=数据看板'],
    });

    await expect(new XhsPageAdapter(page as any).detectLoginState()).resolves.toBe('authenticated');
  });

  it('does not treat a risk verification page as authenticated', async () => {
    const page = fakePage({
      url: 'https://creator.xiaohongshu.com/login',
      visibleSelectors: ['text=安全验证'],
    });

    await expect(new XhsPageAdapter(page as any).detectLoginState()).resolves.toBe('verification_required');
  });

  it('captures only the first visible QR element', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const screenshot = vi.fn(async () => png);
    const page = fakePage({
      url: 'https://creator.xiaohongshu.com/login',
      visibleSelectors: ['[class*="qrcode"] canvas'],
      screenshot,
    });

    await expect(new XhsPageAdapter(page as any).captureQr()).resolves.toEqual(png);
    expect(screenshot).toHaveBeenCalledWith({ type: 'png' });
  });
});

function fakePage(options: {
  url: string;
  visibleSelectors: string[];
  screenshot?: () => Promise<Buffer>;
}) {
  return {
    url: () => options.url,
    locator: (selector: string) => ({
      first: () => ({
        isVisible: async () => options.visibleSelectors.includes(selector),
        screenshot: options.screenshot ?? vi.fn(async () => Buffer.from([])),
      }),
    }),
  };
}
