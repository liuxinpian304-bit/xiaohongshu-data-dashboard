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
  void session;
  return [];
}
