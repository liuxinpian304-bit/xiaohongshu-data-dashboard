import type { Platform } from '@xhs/domain';

import type { XiaohuohuaSession } from './client';

export interface DiscoveredPlatformAccount {
  platform: Platform;
  platformId: string;
  displayName: string;
  avatarUrl: null;
  loginState: 'authenticated';
  surfaceId: string;
}

export async function discoverAccounts(session: XiaohuohuaSession): Promise<DiscoveredPlatformAccount[]> {
  if (session.status === 'unavailable') return [];
  const pages = await session.visibleText();
  const found = new Map<string, DiscoveredPlatformAccount>();
  for (const [index, text] of pages.entries()) {
    const name = visibleDouyinName(text);
    if (!name) continue;
    const platformId = `visible:${name}`;
    found.set(platformId, { platform: 'douyin', platformId, displayName: name, avatarUrl: null, loginState: 'authenticated', surfaceId: `xiaohuohua:${index}` });
  }
  return [...found.values()];
}

function visibleDouyinName(text: string): string | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of [...lines].reverse()) {
    if (/^https?:\/\//i.test(line)) continue;
    if (/^[A-Za-z][A-Za-z0-9_. -]{1,79}$/.test(line)) return line;
    const visiblePart = line.split(/https?:\/\//i, 1)[0] ?? '';
    const candidates = [...visiblePart.matchAll(/\b[A-Za-z][A-Za-z0-9_.-]{1,79}\b/g)].map((match) => match[0]!);
    const candidate = candidates.at(-1);
    if (candidate && !/^(https?|www)$/i.test(candidate)) return candidate;
  }
  return null;
}
