import { describe, expect, it } from 'vitest';

import {
  parseObservationSource,
  parsePlatform,
  platformIdentityKey,
} from './platform';

describe('platform contracts', () => {
  it('keeps identical remote ids isolated by platform', () => {
    expect(platformIdentityKey('xiaohongshu', '42')).toBe('xiaohongshu:42');
    expect(platformIdentityKey('douyin', '42')).toBe('douyin:42');
  });

  it.each(['xiaohongshu', 'douyin'] as const)('accepts supported platform %s', (platform) => {
    expect(parsePlatform(platform)).toBe(platform);
  });

  it('rejects unsupported platforms instead of silently mixing their ids', () => {
    expect(() => parsePlatform('kuaishou')).toThrow('unsupported_platform');
  });

  it.each(['xiaohuohua', 'self-import', 'official', 'mock', 'self-scrape', 'legacy'] as const)(
    'accepts supported observation source %s',
    (source) => {
      expect(parseObservationSource(source)).toBe(source);
    },
  );

  it('rejects a source that could expose credentials', () => {
    expect(() => parseObservationSource('cookie-dump')).toThrow('unsupported_source');
  });

  it('rejects empty remote ids when building an identity key', () => {
    expect(() => platformIdentityKey('douyin', '   ')).toThrow('invalid_platform_id');
  });
});
