import { Inject, Injectable } from '@nestjs/common';
import { prisma, type DatabaseClient } from '@xhs/database';
import { LocalCollectorService, type CollectorStatus } from '../local-collector/local-collector.service';

export const SETTINGS_DB = Symbol('SETTINGS_DB');
type Health = 'healthy' | 'unhealthy' | 'disabled';

@Injectable()
export class SettingsService {
  constructor(@Inject(SETTINGS_DB) private readonly db: DatabaseClient, @Inject(LocalCollectorService) private readonly collector: LocalCollectorService) {}

  async status() {
    let database: Health = 'healthy'; let collector: Health = 'healthy'; let session: CollectorStatus | null = null;
    try { await this.db.$queryRaw`SELECT 1`; } catch { database = 'unhealthy'; }
    try { session = await this.collector.action('status'); } catch { collector = process.env.LOCAL_XHS_COLLECTOR_ENABLED === 'false' ? 'disabled' : 'unhealthy'; }
    const identity = session?.state === 'authenticated' ? session.identity : undefined;
    return {
      api: 'healthy' as Health,
      database,
      collector,
      account: identity ? { displayName: identity.displayName, xhsAccountId: identity.xhsAccountId, platformId: identity.platformId, avatarUrl: identity.avatarUrl, loginState: 'authenticated' as const } : null,
      version: process.env.APP_VERSION?.trim() || '本地版本',
      timezone: 'Asia/Shanghai' as const,
    };
  }
}

export const settingsDatabaseProvider = { provide: SETTINGS_DB, useValue: prisma };
