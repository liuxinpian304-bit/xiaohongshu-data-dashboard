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
  });

  it('requires a stable official identity instead of a visible nickname', () => {
    expect(parseDouyinIdentity({ data: { user: { uid: '7390000000000000000', unique_id: 'tonic123', nickname: 'Tonic', avatar_url: 'https://p3.douyinpic.com/avatar.jpeg' } } })).toEqual({
      platformId: 'douyin:7390000000000000000', douyinAccountId: 'tonic123', displayName: 'Tonic', avatarUrl: 'https://p3.douyinpic.com/avatar.jpeg',
    });
    expect(parseDouyinIdentity({ data: { user: { nickname: 'Tonic' } } })).toBeNull();
  });
});
