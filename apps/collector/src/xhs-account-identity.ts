export interface XhsAccountIdentity {
  platformId: string;
  xhsAccountId: string | null;
  displayName: string;
  avatarUrl: string | null;
}

export interface XhsAccountIdentifiers { platformId: string; xhsAccountId: string | null }

const platformIdKeys = ['user_id', 'userId', 'userid'] as const;
const accountIdKeys = ['red_id', 'redId', 'redid'] as const;
const displayNameKeys = ['nickname', 'nickName', 'name'] as const;
const avatarKeys = ['avatar', 'avatarUrl', 'image'] as const;

export function parseXhsAccountIdentity(value: unknown): XhsAccountIdentity | null {
  const queue: unknown[] = [value];
  let visited = 0;
  while (queue.length && visited < 2_000) {
    const candidate = queue.shift();
    visited += 1;
    if (Array.isArray(candidate)) {
      queue.push(...candidate.slice(0, 200));
      continue;
    }
    if (!plainObject(candidate)) continue;
    const platformId = boundedString(candidate, platformIdKeys);
    const displayName = boundedString(candidate, displayNameKeys);
    if (platformId && displayName) {
      return {
        platformId,
        xhsAccountId: boundedString(candidate, accountIdKeys),
        displayName,
        avatarUrl: safeAvatar(boundedString(candidate, avatarKeys, 2_048)),
      };
    }
    queue.push(...Object.values(candidate).slice(0, 200));
  }
  return null;
}

export function parseXhsAccountIdentifiers(value: unknown): XhsAccountIdentifiers | null {
  const queue: unknown[] = [value];
  let visited = 0;
  while (queue.length && visited < 2_000) {
    const candidate = queue.shift();
    visited += 1;
    if (Array.isArray(candidate)) { queue.push(...candidate.slice(0, 200)); continue; }
    if (!plainObject(candidate)) continue;
    const platformId = boundedString(candidate, platformIdKeys);
    if (platformId) return { platformId, xhsAccountId: boundedString(candidate, accountIdKeys) };
    queue.push(...Object.values(candidate).slice(0, 200));
  }
  return null;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function boundedString(object: Record<string, unknown>, keys: readonly string[], maxLength = 200) {
  for (const key of keys) {
    const value = object[key];
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (normalized.length > 0 && normalized.length <= maxLength) return normalized;
  }
  return null;
}

function safeAvatar(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
