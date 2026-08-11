import type { DouyinIdentity } from './douyin-types';

export type DouyinLoginState = 'loading' | 'awaiting_scan' | 'authenticated' | 'verification_required';

interface ElementSurface {
  isVisible(): Promise<boolean>;
  screenshot(options?: { type: 'png' }): Promise<Buffer>;
}

export interface DouyinPageSurface {
  url(): string;
  locator(selector: string): { first(): ElementSurface };
}

const allowedHosts = new Set(['creator.douyin.com', 'creator-micro.douyin.com']);
const qrSelectors = ['[data-e2e="qrcode"]', '[class*="qrcode"] canvas', '[class*="qrcode"] img', 'img[alt*="二维码"]'];
const verificationSelectors = ['text=安全验证', 'text=短信验证', 'text=请输入验证码'];
const authenticatedSelectors = ['text=创作中心', 'text=作品管理', 'text=数据中心'];

export class DouyinPageAdapter {
  constructor(private readonly page: DouyinPageSurface, private readonly identityPayload: () => Promise<unknown> = async () => null) {}

  async detectLoginState(): Promise<DouyinLoginState> {
    assertOfficialUrl(this.page.url());
    if (await this.anyVisible(verificationSelectors)) return 'verification_required';
    if (await this.anyVisible(qrSelectors)) return 'awaiting_scan';
    if (await this.anyVisible(authenticatedSelectors)) return 'authenticated';
    return 'loading';
  }

  async captureQr(): Promise<Buffer> {
    assertOfficialUrl(this.page.url());
    for (const selector of qrSelectors) {
      const element = this.page.locator(selector).first();
      if (await element.isVisible()) return element.screenshot({ type: 'png' });
    }
    throw new Error('douyin_qr_not_found');
  }

  async readIdentity(): Promise<DouyinIdentity> {
    assertOfficialUrl(this.page.url());
    const identity = parseDouyinIdentity(await this.identityPayload());
    if (!identity) throw new Error('douyin_identity_unavailable');
    return identity;
  }

  private async anyVisible(selectors: readonly string[]) {
    for (const selector of selectors) if (await this.page.locator(selector).first().isVisible()) return true;
    return false;
  }
}

export function assertOfficialUrl(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('douyin_origin_rejected'); }
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error('douyin_origin_rejected');
  return url;
}

export function parseDouyinIdentity(input: unknown): DouyinIdentity | null {
  const queue: unknown[] = [input];
  let visited = 0;
  while (queue.length && visited++ < 10_000) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) { queue.push(...current.slice(0, 1_000)); continue; }
    const value = current as Record<string, unknown>;
    const uid = text(value.uid) ?? text(value.user_id) ?? text(value.sec_uid);
    const displayName = text(value.nickname) ?? text(value.nick_name);
    const douyinAccountId = text(value.unique_id) ?? text(value.short_id) ?? text(value.douyin_id);
    if (uid && displayName && douyinAccountId) {
      if (douyinAccountId.toLowerCase() === 'dyczxzs' || displayName === '抖音作者助手') continue;
      const avatarUrl = httpsUrl(value.avatar_url) ?? httpsUrl(value.avatar) ?? null;
      return { platformId: `douyin:${uid}`, douyinAccountId, displayName, avatarUrl };
    }
    queue.push(...Object.values(value).slice(0, 1_000));
  }
  return null;
}

function text(value: unknown) {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length < 1 || String(value).length > 200) return null;
  return String(value);
}

function httpsUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
