import type { BrowserContext, Page, Response } from 'playwright';

import { DouyinPageAdapter, assertOfficialUrl, parseDouyinIdentity, type DouyinPageSurface } from './douyin-page-adapter';
import { DouyinRegistry } from './douyin-registry';
import { DouyinSessionManager } from './douyin-session-manager';
import { DouyinSessionStore } from './douyin-session-store';
import { collectDouyinEvents } from './douyin-collection';

type LaunchPersistentContext = (profileDirectory: string, options: { headless: false; channel: 'chrome' }) => Promise<BrowserContext>;

export function createRuntimeDouyinRegistry(root: string, launchPersistentContext: LaunchPersistentContext) {
  const store = new DouyinSessionStore(root);
  return new DouyinRegistry(store, (record) => {
    let page: Page | null = null;
    let identityPayload: unknown = null;
    let collectionPayloads: unknown[] | null = null;
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
        page.on('response', async (response) => {
          const payload = await safeOfficialPayload(response, collectionPayloads ? 5 * 1024 * 1024 : 1024 * 1024);
          if (!payload) return;
          if (parseDouyinIdentity(payload)) identityPayload = payload;
          if (collectionPayloads && collectionPayloads.length < 1_000) {
            collectionPayloads.push(payload);
            const shape = safePayloadShape(response.url(), payload);
            if (shape) console.info('douyin_payload_shape', JSON.stringify(shape));
          }
        });
        await page.goto('https://creator.douyin.com/creator-micro/home', { waitUntil: 'domcontentloaded', timeout: 30_000 });
        return { close: async () => { page = null; identityPayload = null; await context.close(); } };
      },
      collect: async (identity, progress, emit, runId) => {
        if (!page) throw new Error('douyin_page_unavailable');
        collectionPayloads = [];
        progress({ stage: 'notes', processed: 0, total: 0, incompleteNotes: 0 });
        try {
          await page.goto('https://creator.douyin.com/creator-micro/content/manage', { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await page.waitForTimeout(5_000);
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(2_000);
          const events = collectDouyinEvents(identity, collectionPayloads, runId, new Date().toISOString());
          const total = events.filter((event) => event.type === 'content').length;
          for (const event of events) emit(event);
          progress({ stage: 'reports', processed: total, total, incompleteNotes: 0 });
        } finally { collectionPayloads = null; }
      },
    });
  });
}

async function safeOfficialPayload(response: Pick<Response, 'url' | 'headers' | 'json'>, maxBytes: number) {
  try {
    assertOfficialUrl(response.url());
    const headers = response.headers();
    if (!String(headers['content-type'] ?? '').toLowerCase().includes('application/json')) return null;
    const length = Number(headers['content-length'] ?? 0);
    if (length > maxBytes) return null;
    return await response.json();
  } catch { return null; }
}

export function safePayloadShape(input: string, payload: unknown) {
  let url: URL;
  try { url = assertOfficialUrl(input); } catch { return null; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { path: url.pathname, keys: [] as string[] };
  const body = payload as Record<string, unknown>;
  const data = body.data;
  const keys = Object.keys(body).sort().slice(0, 40);
  const dataKeys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data as Record<string, unknown>).sort().slice(0, 40) : [];
  return { path: url.pathname, keys, dataKeys };
}
