import { describe, expect, it } from 'vitest';
import { commentWhere } from './comments.service';

describe('commentWhere', () => {
  it('scopes comments by their platform and preserves account filters', () => {
    expect(commentWhere({ platform: 'douyin', accountId: 'account-1' })).toEqual({ platform: 'douyin', note: { accountId: { in: ['account-1'] } } });
    expect(commentWhere({ platform: 'xiaohongshu' })).toEqual({ platform: 'xiaohongshu' });
  });
});
