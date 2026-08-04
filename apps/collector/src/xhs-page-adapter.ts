import { parseCreatorPayload, type CreatorCommentRecord, type CreatorNoteRecord } from './creator-payload';

export type DetectedLoginState = 'loading' | 'awaiting_scan' | 'authenticated' | 'verification_required';
interface XhsElementSurface {
  isVisible(): Promise<boolean>;
  screenshot(options: { type: 'png' }): Promise<Buffer>;
  click(): Promise<void>;
  isEnabled?(): Promise<boolean>;
  evaluate<TResult>(fn: (element: { clientWidth: number; clientHeight: number }) => TResult): Promise<TResult>;
}
export interface XhsPageSurface {
  url(): string;
  locator(selector: string): {
    first(): XhsElementSurface;
    all(): Promise<XhsElementSurface[]>;
  };
  on?(event: 'response', listener: (response: XhsResponseSurface) => void): void;
  off?(event: 'response', listener: (response: XhsResponseSurface) => void): void;
  goto?(url: string, options?: { waitUntil?: 'domcontentloaded'; timeout?: number }): Promise<unknown>;
  waitForTimeout?(milliseconds: number): Promise<void>;
}

interface XhsResponseSurface {
  url(): string;
  headers(): Record<string, string> | Promise<Record<string, string>>;
  json(): Promise<unknown>;
}

export class CollectionPager {
  private readonly seen = new Set<string>();

  next(page: { cursor: string | null; hasMore: boolean }): { done: true } | { done: false; cursor: string } {
    if (!page.hasMore) return { done: true };
    if (!page.cursor) throw new Error('collector_page_changed');
    if (this.seen.has(page.cursor)) throw new Error('collector_repeated_cursor');
    this.seen.add(page.cursor);
    return { done: false, cursor: page.cursor };
  }
}

const verificationSelectors = [
  'text=安全验证',
  'text=短信验证',
  'text=请输入验证码',
] as const;

const authenticatedSelectors = [
  'text=数据看板',
  'text=笔记管理',
  'text=创作服务平台',
] as const;

const qrSelectors = [
  '[class*="qrcode"] canvas',
  '[class*="qr-code"] canvas',
  'img[alt*="二维码"]',
  '[class*="qrcode"] img',
] as const;

export class XhsPageAdapter {
  private qrModeRequested = false;

  constructor(private readonly page: XhsPageSurface) {}

  async prepareLogin() {
    if (new URL(this.page.url()).pathname !== '/login') return;
    if (await this.qrImage()) { this.qrModeRequested = true; return; }
    if (this.qrModeRequested) return;
    const toggles = await this.page.locator('.sso-login-wrapper img').all();
    for (const toggle of toggles) {
      const dimensions = await toggle.evaluate((element) => ({ width: element.clientWidth, height: element.clientHeight }));
      if (dimensions.width >= 40 && dimensions.width <= 96 && dimensions.width === dimensions.height && await toggle.isVisible()) {
        await toggle.click();
        this.qrModeRequested = true;
        return;
      }
    }
  }

  async detectLoginState(): Promise<DetectedLoginState> {
    if (await this.anyVisible(verificationSelectors)) return 'verification_required';
    const url = new URL(this.page.url());
    if (url.origin === 'https://creator.xiaohongshu.com' && !url.pathname.startsWith('/login') && await this.anyVisible(authenticatedSelectors)) {
      return 'authenticated';
    }
    if (await this.qrImage() || await this.anyVisible(qrSelectors)) return 'awaiting_scan';
    return 'loading';
  }

  async captureQr(): Promise<Buffer> {
    const qr = await this.qrImage();
    if (qr) return qr.screenshot({ type: 'png' });
    for (const selector of qrSelectors) {
      const element = this.page.locator(selector).first();
      if (await element.isVisible()) return element.screenshot({ type: 'png' });
    }
    throw new Error('collector_qr_not_found');
  }

  async collectVisibleRecords(capturedAt = new Date().toISOString()): Promise<{ notes: CreatorNoteRecord[]; comments: CreatorCommentRecord[] }> {
    if (await this.detectLoginState() !== 'authenticated') throw new Error('collector_authentication_required');
    if (!this.page.on || !this.page.off || !this.page.goto) throw new Error('collector_page_changed');
    const notes = new Map<string, CreatorNoteRecord>();
    const comments = new Map<string, CreatorCommentRecord>();
    const pending = new Set<Promise<void>>();
    const listener = (response: XhsResponseSurface) => {
      const task = this.consumeCreatorResponse(response, capturedAt, notes, comments).finally(() => pending.delete(task));
      pending.add(task);
    };
    this.page.on('response', listener);
    try {
      await this.page.goto('https://creator.xiaohongshu.com/new/note-manager', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await this.settleResponses(pending, () => notes.size > 0, 40);
      await this.clickThroughVisiblePages(pending, () => notes.size);
      const commentNavigation = this.page.locator('text=评论管理').first();
      if (await commentNavigation.isVisible()) {
        await commentNavigation.click();
        await this.settleResponses(pending, () => comments.size > 0, 20);
        await this.clickThroughVisiblePages(pending, () => comments.size);
      }
      return { notes: [...notes.values()], comments: [...comments.values()] };
    } finally {
      this.page.off('response', listener);
    }
  }

  private async consumeCreatorResponse(response: XhsResponseSurface, capturedAt: string, notes: Map<string, CreatorNoteRecord>, comments: Map<string, CreatorCommentRecord>) {
    let url: URL;
    try { url = new URL(response.url()); } catch { return; }
    if (url.origin !== 'https://creator.xiaohongshu.com') return;
    const headers = await response.headers();
    if (!headers['content-type']?.toLowerCase().includes('json')) return;
    const declared = Number(headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > 5_000_000) return;
    try {
      const parsed = parseCreatorPayload(await response.json(), capturedAt);
      for (const note of parsed.notes) notes.set(note.platformId, note);
      for (const comment of parsed.comments) comments.set(comment.platformId, comment);
    } catch { /* Ignore unrelated or structurally unsafe creator responses. */ }
  }

  private async settleResponses(pending: Set<Promise<void>>, ready: () => boolean = () => true, attempts = 1) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await this.page.waitForTimeout?.(250);
      while (pending.size) await Promise.all([...pending]);
      if (ready()) return;
    }
  }

  private async clickThroughVisiblePages(pending: Set<Promise<void>>, recordCount: () => number) {
    for (let page = 0; page < 1_000; page += 1) {
      const next = this.page.locator('text=下一页').first();
      if (!await next.isVisible() || (next.isEnabled && !await next.isEnabled())) return;
      const before = recordCount();
      await next.click();
      await this.settleResponses(pending, () => recordCount() > before, 20);
      if (recordCount() <= before) return;
    }
    throw new Error('collector_page_limit_exceeded');
  }

  private async qrImage() {
    const images = await this.page.locator('.sso-login-wrapper img[src^="data:image/png"]').all();
    for (const image of images) {
      if (!await image.isVisible()) continue;
      const dimensions = await image.evaluate((element) => ({ width: element.clientWidth, height: element.clientHeight }));
      if (dimensions.width >= 128 && dimensions.width <= 512 && dimensions.width === dimensions.height) return image;
    }
    return null;
  }

  private async anyVisible(selectors: readonly string[]) {
    for (const selector of selectors) {
      if (await this.page.locator(selector).first().isVisible()) return true;
    }
    return false;
  }
}
