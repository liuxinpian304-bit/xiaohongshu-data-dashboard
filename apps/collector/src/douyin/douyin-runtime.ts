import type { BrowserContext, Page, Response } from 'playwright';

import { DouyinPageAdapter, assertOfficialUrl, parseDouyinIdentity, type DouyinPageSurface } from './douyin-page-adapter';
import { DouyinRegistry } from './douyin-registry';
import { DouyinSessionManager } from './douyin-session-manager';
import { DouyinSessionStore } from './douyin-session-store';

type LaunchPersistentContext = (profileDirectory: string, options: { headless: false; channel: 'chrome' }) => Promise<BrowserContext>;

export function createRuntimeDouyinRegistry(root: string, launchPersistentContext: LaunchPersistentContext) {
  const store = new DouyinSessionStore(root);
  return new DouyinRegistry(store, (record) => {
    let page: Page | null = null;
    let identityPayload: unknown = null;
    const surface: DouyinPageSurface = {
      url: () => page?.url() ?? 'https://creator.douyin.com/',
      locator: (selector) => {
        if (!page) throw new Error('douyin_page_unavailable');
        return page.locator(selector) as unknown as ReturnType<DouyinPageSurface['locator']>;
      },
    };
    const adapter = new DouyinPageAdapter(surface, async () => identityPayload);
    return new DouyinSessionManager(record, {
      store,
      adapter,
      launch: async (profileDirectory) => {
        const context = await launchPersistentContext(profileDirectory, { headless: false, channel: 'chrome' });
        page = context.pages()[0] ?? await context.newPage();
        page.on('response', async (response) => { const payload = await safeIdentityPayload(response); if (payload) identityPayload = payload; });
        await page.goto('https://creator.douyin.com/creator-micro/home', { waitUntil: 'domcontentloaded', timeout: 30_000 });
        return { close: async () => { page = null; identityPayload = null; await context.close(); } };
      },
    });
  });
}

async function safeIdentityPayload(response: Pick<Response, 'url' | 'headers' | 'json'>) {
  try {
    assertOfficialUrl(response.url());
    const headers = response.headers();
    if (!String(headers['content-type'] ?? '').toLowerCase().includes('application/json')) return null;
    const length = Number(headers['content-length'] ?? 0);
    if (length > 1024 * 1024) return null;
    const payload = await response.json();
    return parseDouyinIdentity(payload) ? payload : null;
  } catch { return null; }
}
