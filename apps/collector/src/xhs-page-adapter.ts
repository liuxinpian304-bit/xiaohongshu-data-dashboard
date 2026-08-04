export type DetectedLoginState = 'loading' | 'awaiting_scan' | 'authenticated' | 'verification_required';
interface XhsElementSurface {
  isVisible(): Promise<boolean>;
  screenshot(options: { type: 'png' }): Promise<Buffer>;
  click(): Promise<void>;
  evaluate<TResult>(fn: (element: { clientWidth: number; clientHeight: number }) => TResult): Promise<TResult>;
}
export interface XhsPageSurface {
  url(): string;
  locator(selector: string): {
    first(): XhsElementSurface;
    all(): Promise<XhsElementSurface[]>;
  };
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
