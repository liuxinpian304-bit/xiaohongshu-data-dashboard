import { describe, expect, it } from 'vitest';
import { commentCsvHeader, commentCsvRow, commentWhere } from './comments.service';

describe('commentWhere', () => {
  it('scopes comments by their platform and preserves account filters', () => {
    expect(commentWhere({ platform: 'douyin', accountId: 'account-1' })).toEqual({ platform: 'douyin', note: { accountId: { in: ['account-1'] } } });
    expect(commentWhere({ platform: 'xiaohongshu' })).toEqual({ platform: 'xiaohongshu' });
  });
  it('exports platform, source, remote ids and capture time', () => {
    expect(commentCsvHeader).toContain('platform,source,platformId,parentPlatformId,authorName');
    expect(commentCsvRow({ id:'1',noteId:'n1',platform:'douyin',source:'self-scrape',platformId:'c1',parentPlatformId:null,authorName:'甲',content:'好',publishedAt:new Date('2026-08-12T00:00:00Z'),likeCount:2,lastSeenAt:new Date('2026-08-12T01:00:00Z') })).toContain('"douyin","self-scrape","c1","","甲"');
  });
});
