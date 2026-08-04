import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export type CollectorAction = 'start' | 'status' | 'confirm' | 'close';
export interface CollectorStatus { state: 'idle' | 'launching' | 'browser_open' | 'user_confirmed' | 'closed' | 'error'; changedAt: string; errorCode?: string }
interface Configuration { enabled: boolean; url: string; token: string; fetcher?: typeof fetch }

@Injectable()
export class LocalCollectorService {
  private readonly configuration: Configuration;

  constructor(configuration?: Configuration) {
    this.configuration = configuration ?? {
      enabled: process.env.LOCAL_XHS_COLLECTOR_ENABLED === 'true',
      url: process.env.LOCAL_XHS_COLLECTOR_URL ?? 'http://127.0.0.1:43127',
      token: process.env.LOCAL_XHS_COLLECTOR_TOKEN ?? '',
    };
  }

  async action(action: CollectorAction): Promise<CollectorStatus> {
    this.assertConfiguration();
    if (!['start', 'status', 'confirm', 'close'].includes(action)) throw new Error('collector_action_invalid');
    const response = await (this.configuration.fetcher ?? fetch)(`${this.configuration.url}/v1/session/${action}`, {
      method: action === 'status' ? 'GET' : 'POST', headers: { authorization: `Bearer ${this.configuration.token}` }, signal: AbortSignal.timeout(5_000),
    }).catch(() => { throw new ServiceUnavailableException('collector_unavailable'); });
    if (!response.ok) throw new ServiceUnavailableException('collector_unavailable');
    const body = await response.json().catch(() => null);
    if (!isCollectorStatus(body)) throw new ServiceUnavailableException('collector_response_invalid');
    return body;
  }

  private assertConfiguration() {
    if (!this.configuration.enabled) throw new ServiceUnavailableException('collector_disabled');
    const url = new URL(this.configuration.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) throw new ServiceUnavailableException('collector_loopback_required');
    if (Buffer.byteLength(this.configuration.token) < 32) throw new ServiceUnavailableException('collector_token_invalid');
  }
}

function isCollectorStatus(value: unknown): value is CollectorStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['state', 'changedAt', 'errorCode'].includes(key))) return false;
  const changedAt = typeof body.changedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(body.changedAt) && Number.isFinite(new Date(body.changedAt).getTime());
  return changedAt && ['idle', 'launching', 'browser_open', 'user_confirmed', 'closed', 'error'].includes(String(body.state)) && (body.errorCode === undefined || body.errorCode === 'collector_launch_failed');
}
