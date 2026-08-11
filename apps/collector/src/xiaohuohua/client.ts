import { chromium } from 'playwright';

export const XIAOHUOHUA_BRIDGE_URL = 'http://127.0.0.1:43128';

export interface XiaohuohuaSession {
  status: 'available' | 'unavailable';
  visibleText(): Promise<string[]>;
  close?(): Promise<void>;
}

export function validateEndpoint(input: string): string {
  let endpoint: URL;
  try { endpoint = new URL(input); } catch { throw new Error('xiaohuohua_loopback_required'); }
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.port !== '43128' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    throw new Error('xiaohuohua_loopback_required');
  }
  return endpoint.origin;
}

export class XiaohuohuaClient {
  async connect({ endpoint = XIAOHUOHUA_BRIDGE_URL }: { endpoint?: string } = {}): Promise<XiaohuohuaSession> {
    const safeEndpoint = validateEndpoint(endpoint);
    try {
      const response = await fetch(`${safeEndpoint}/json/version`, { signal: AbortSignal.timeout(3_000) });
      if (!response.ok) return unavailableSession;
      const browser = await chromium.connectOverCDP(safeEndpoint, { timeout: 3_000 });
      return {
        status: 'available',
        async visibleText() {
          const pages = browser.contexts().flatMap((context) => context.pages());
          return Promise.all(pages.map(async (page) => {
            const text = await page.locator('body').innerText({ timeout: 3_000 }).catch(() => '');
            return text.slice(0, 20_000);
          }));
        },
        async close() { await browser.close(); },
      };
    } catch {
      return unavailableSession;
    }
  }
}

const unavailableSession: XiaohuohuaSession = { status: 'unavailable', async visibleText() { return []; } };
