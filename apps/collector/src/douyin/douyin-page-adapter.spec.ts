import { describe, expect, it } from 'vitest';

import { DouyinPageAdapter, parseDouyinIdentity } from './douyin-page-adapter';

function page(url: string, visible: string[] = []) {
  return {
    url: () => url,
    locator: (selector: string) => ({
      first: () => ({
        isVisible: async () => visible.includes(selector),
        screenshot: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      }),
    }),
  };
}

describe('DouyinPageAdapter', () => {
  it('rejects pages outside official Douyin creator origins', async () => {
    await expect(new DouyinPageAdapter(page('https://evil.test/login')).detectLoginState()).rejects.toThrow('douyin_origin_rejected');
  });

  it('detects QR login and security verification without bypassing either', async () => {
    await expect(new DouyinPageAdapter(page('https://creator.douyin.com/', ['[data-e2e="qrcode"]'])).detectLoginState()).resolves.toBe('awaiting_scan');
    await expect(new DouyinPageAdapter(page('https://creator.douyin.com/', ['text=安全验证'])).detectLoginState()).resolves.toBe('verification_required');
    await expect(new DouyinPageAdapter(page('https://creator.douyin.com/creator-micro/home', ['[class*="qrcode"] canvas'])).detectLoginState()).resolves.toBe('awaiting_scan');
  });

  it('does not mistake an authenticated creator chart canvas for a login QR code', async () => {
    await expect(new DouyinPageAdapter(page('https://creator.douyin.com/creator-micro/content/manage', ['canvas', 'text=作品管理'])).detectLoginState()).resolves.toBe('authenticated');
  });

  it('requires a stable official identity instead of a visible nickname', () => {
    expect(parseDouyinIdentity({ data: { user: { uid: '7390000000000000000', unique_id: 'tonic123', nickname: 'Tonic', avatar_url: 'https://p3.douyinpic.com/avatar.jpeg' } } })).toEqual({
      platformId: 'douyin:7390000000000000000', douyinAccountId: 'tonic123', displayName: 'Tonic', avatarUrl: 'https://p3.douyinpic.com/avatar.jpeg',
    });
    expect(parseDouyinIdentity({ data: { user: { nickname: 'Tonic' } } })).toBeNull();
    expect(parseDouyinIdentity({ data: { user: { uid: '92769419069', unique_id: 'dyczxzs', nickname: '抖音作者助手' } } })).toBeNull();
  });

  it('reads only a stable identity captured from an official creator response', async () => {
    const adapter = new DouyinPageAdapter(page('https://creator.douyin.com/creator-micro/home'), async () => ({ data: { user: { uid: '7390000000000000000', unique_id: 'tonic123', nickname: 'Tonic' } } }));
    await expect(adapter.readIdentity()).resolves.toMatchObject({ platformId: 'douyin:7390000000000000000', douyinAccountId: 'tonic123', displayName: 'Tonic' });
  });

  it('rejects an authenticated surface without a stable captured identity', async () => {
    const adapter = new DouyinPageAdapter(page('https://creator.douyin.com/creator-micro/home'), async () => ({ data: { nickname: 'Tonic' } }));
    await expect(adapter.readIdentity()).rejects.toThrow('douyin_identity_unavailable');
  });
});
