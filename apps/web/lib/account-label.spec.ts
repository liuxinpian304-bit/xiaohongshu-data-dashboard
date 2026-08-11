import { describe, expect, it } from 'vitest';

import { accountLabel } from './account-label';

describe('accountLabel', () => {
  it('keeps Xiaohongshu and Douyin accounts visibly distinct', () => {
    expect(accountLabel({ platform: 'xiaohongshu', displayName: '南瓜汤与瓜子仁', platformId: 'xhs-1' })).toBe('小红书 · 南瓜汤与瓜子仁');
    expect(accountLabel({ platform: 'douyin', displayName: 'Tonic', platformId: 'dy-1' })).toBe('抖音 · Tonic');
  });

  it('falls back to the platform id when the nickname is unavailable', () => {
    expect(accountLabel({ platform: 'xiaohongshu', displayName: null, platformId: '95874286519' })).toBe('小红书 · 95874286519');
  });
});
