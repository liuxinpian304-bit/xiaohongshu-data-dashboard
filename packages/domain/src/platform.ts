export const PLATFORMS = ['xiaohongshu', 'douyin'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const OBSERVATION_SOURCES = [
  'xiaohuohua',
  'self-import',
  'official',
  'mock',
  'self-scrape',
  'legacy',
] as const;
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];

export type ContentKind = 'note' | 'video' | 'image_text';
export type CommentCompletenessState = 'complete' | 'partial' | 'failed' | 'not_available';

export function parsePlatform(value: unknown): Platform {
  if (!PLATFORMS.includes(value as Platform)) throw new Error('unsupported_platform');
  return value as Platform;
}

export function parseObservationSource(value: unknown): ObservationSource {
  if (!OBSERVATION_SOURCES.includes(value as ObservationSource)) throw new Error('unsupported_source');
  return value as ObservationSource;
}

export function platformIdentityKey(platform: Platform, platformId: string) {
  const normalizedId = platformId.trim();
  if (!normalizedId) throw new Error('invalid_platform_id');
  return `${platform}:${normalizedId}`;
}
