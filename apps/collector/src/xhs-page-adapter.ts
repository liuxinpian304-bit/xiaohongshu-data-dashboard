export type DetectedLoginState = 'awaiting_scan' | 'authenticated' | 'verification_required';
export interface XhsPageSurface {
  url(): string;
  locator(selector: string): {
    first(): {
      isVisible(): Promise<boolean>;
      screenshot(options: { type: 'png' }): Promise<Buffer>;
    };
  };
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
  constructor(private readonly page: XhsPageSurface) {}

  async detectLoginState(): Promise<DetectedLoginState> {
    if (await this.anyVisible(verificationSelectors)) return 'verification_required';
    const url = new URL(this.page.url());
    if (url.origin === 'https://creator.xiaohongshu.com' && !url.pathname.startsWith('/login') && await this.anyVisible(authenticatedSelectors)) {
      return 'authenticated';
    }
    return 'awaiting_scan';
  }

  async captureQr(): Promise<Buffer> {
    for (const selector of qrSelectors) {
      const element = this.page.locator(selector).first();
      if (await element.isVisible()) return element.screenshot({ type: 'png' });
    }
    throw new Error('collector_qr_not_found');
  }

  private async anyVisible(selectors: readonly string[]) {
    for (const selector of selectors) {
      if (await this.page.locator(selector).first().isVisible()) return true;
    }
    return false;
  }
}
