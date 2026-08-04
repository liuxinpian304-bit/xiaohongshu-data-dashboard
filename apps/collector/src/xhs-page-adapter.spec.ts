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

  it('keeps an unrendered creator SPA in loading state instead of claiming a QR exists', async () => {
    const page = fakePage({
      url: 'https://creator.xiaohongshu.com/',
      visibleSelectors: [],
    });

    await expect(new XhsPageAdapter(page as any).detectLoginState()).resolves.toBe('loading');
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

  it('switches the official login card into QR mode when only the corner toggle is present', async () => {
    const click = vi.fn(async () => undefined);
    const page = fakePage({
      url: 'https://creator.xiaohongshu.com/login',
      visibleSelectors: ['.sso-login-wrapper img'],
      elements: { '.sso-login-wrapper img': [{ width: 64, height: 64, click }] },
    });

    await new XhsPageAdapter(page as any).prepareLogin();

    expect(click).toHaveBeenCalledOnce();
  });

  it('selects the square data PNG by rendered dimensions instead of generated class names', async () => {
    const qr = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const page = fakePage({
      url: 'https://creator.xiaohongshu.com/login',
      visibleSelectors: [],
      elements: {
        '.sso-login-wrapper img[src^="data:image/png"]': [
          { width: 64, height: 64 },
          { width: 160, height: 160, screenshot: async () => qr },
        ],
      },
    });

    await expect(new XhsPageAdapter(page as any).captureQr()).resolves.toEqual(qr);
  });
});

function fakePage(options: {
  url: string;
  visibleSelectors: string[];
  screenshot?: () => Promise<Buffer>;
  elements?: Record<string, Array<{ width: number; height: number; screenshot?: () => Promise<Buffer>; click?: () => Promise<void> }>>;
}) {
  const element = (selector: string, entry?: { width: number; height: number; screenshot?: () => Promise<Buffer>; click?: () => Promise<void> }) => ({
    isVisible: async () => entry ? true : options.visibleSelectors.includes(selector),
    screenshot: entry?.screenshot ?? options.screenshot ?? vi.fn(async () => Buffer.from([])),
    click: entry?.click ?? vi.fn(async () => undefined),
    evaluate: async (fn: (element: { clientWidth: number; clientHeight: number }) => unknown) => fn({ clientWidth: entry?.width ?? 0, clientHeight: entry?.height ?? 0 }),
  });
  return {
    url: () => options.url,
    locator: (selector: string) => ({
      first: () => element(selector, options.elements?.[selector]?.[0]),
      all: async () => (options.elements?.[selector] ?? []).map((entry) => element(selector, entry)),
    }),
  };
}
