import { describe, expect, it } from 'vitest';

import { parseXhsAccountIdentity } from './xhs-account-identity';

describe('parseXhsAccountIdentity', () => {
  it('copies only bounded public identity fields from an authenticated profile payload', () => {
    const identity = parseXhsAccountIdentity({
      data: {
        user_id: '5f-stable-user',
        red_id: 'red_123',
        nickname: '吉祥',
        avatar: 'https://sns-avatar-qc.xhscdn.com/avatar.jpg',
        cookie: 'web_session=must-not-leak',
      },
    });

    expect(identity).toEqual({
      platformId: '5f-stable-user',
      xhsAccountId: 'red_123',
      displayName: '吉祥',
      avatarUrl: 'https://sns-avatar-qc.xhscdn.com/avatar.jpg',
    });
    expect(JSON.stringify(identity)).not.toContain('must-not-leak');
  });

  it('rejects a nickname without a stable platform identity', () => {
    expect(parseXhsAccountIdentity({ data: { nickname: '没有稳定 ID' } })).toBeNull();
  });

  it('rejects non-HTTPS avatar URLs without rejecting the account identity', () => {
    expect(parseXhsAccountIdentity({ userId: 'user-1', name: '账号', avatarUrl: 'http://example.test/avatar.jpg' })).toEqual({
      platformId: 'user-1',
      xhsAccountId: null,
      displayName: '账号',
      avatarUrl: null,
    });
  });
});
