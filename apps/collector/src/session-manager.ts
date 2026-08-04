import { chmod, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { chromium } from 'playwright';
import { XhsPageAdapter, type XhsPageSurface } from './xhs-page-adapter';

export type SessionState = 'idle' | 'launching' | 'browser_open' | 'user_confirmed' | 'awaiting_scan' | 'authenticated' | 'verification_required' | 'expired' | 'closed' | 'error';
export interface SessionStatus { state: SessionState; changedAt: string; qrExpiresAt?: string; errorCode?: 'collector_launch_failed' }
export interface QrSnapshot { bytes: Buffer; contentType: 'image/png'; expiresAt: string; etag: string }
interface BrowserHandle { close(): Promise<void>; page?: XhsPageSurface }
interface LaunchOptions { profileDirectory: string; headless: false; url: string }
interface PageAdapter {
  detectLoginState(): Promise<'awaiting_scan' | 'authenticated' | 'verification_required'>;
  captureQr(): Promise<Buffer>;
}

export interface SessionManagerOptions {
  profileDirectory: string;
  launch?: (options: LaunchOptions) => Promise<BrowserHandle>;
  adapter?: PageAdapter;
}

export class LocalXhsSessionManager {
  private handle: BrowserHandle | null = null;
  private current: SessionStatus = { state: 'idle', changedAt: new Date().toISOString() };
  private launching: Promise<SessionStatus> | null = null;
  private qrSnapshot: QrSnapshot | null = null;
  private adapter: PageAdapter | null;

  constructor(private readonly options: SessionManagerOptions) {
    this.adapter = options.adapter ?? null;
  }

  status(): SessionStatus { return { ...this.current }; }

  async refresh() {
    if (!this.adapter) return this.status();
    const state = await this.adapter.detectLoginState();
    if (state === 'awaiting_scan') {
      const bytes = await this.adapter.captureQr();
      if (!validQrPng(bytes)) {
        throw new Error('collector_qr_invalid');
      }
      const expiresAt = new Date(Date.now() + 120_000).toISOString();
      this.qrSnapshot = { bytes, contentType: 'image/png', expiresAt, etag: `"${createHash('sha256').update(bytes).digest('hex')}"` };
      this.current = { state, changedAt: new Date().toISOString(), qrExpiresAt: expiresAt };
      return this.status();
    } else {
      this.destroyQr();
    }
    this.setState(state);
    return this.status();
  }

  qr(): QrSnapshot {
    if (!this.qrSnapshot || Date.now() >= new Date(this.qrSnapshot.expiresAt).getTime()) {
      this.destroyQr();
      throw new Error('collector_qr_expired');
    }
    return { ...this.qrSnapshot, bytes: Buffer.from(this.qrSnapshot.bytes) };
  }

  async start() {
    if (['browser_open', 'user_confirmed', 'awaiting_scan', 'authenticated', 'verification_required'].includes(this.current.state)) return this.status();
    if (this.launching) return this.launching;
    this.setState('launching');
    this.launching = this.launch().finally(() => { this.launching = null; });
    return this.launching;
  }

  async close() {
    const pending = this.launching;
    if (pending) await pending.catch(() => undefined);
    const handle = this.handle;
    this.handle = null;
    if (handle) await handle.close();
    this.destroyQr();
    this.setState('closed');
    return this.status();
  }

  private async launch() {
    try {
      await mkdir(this.options.profileDirectory, { recursive: true, mode: 0o700 });
      await chmod(this.options.profileDirectory, 0o700);
      const launch = this.options.launch ?? launchPersistentChromium;
      this.handle = await launch({ profileDirectory: this.options.profileDirectory, headless: false, url: 'https://creator.xiaohongshu.com/' });
      if (!this.adapter && this.handle.page) this.adapter = new XhsPageAdapter(this.handle.page);
      if (this.adapter) return this.refresh();
      this.setState('browser_open');
      return this.status();
    } catch {
      this.current = { state: 'error', changedAt: new Date().toISOString(), errorCode: 'collector_launch_failed' };
      throw new Error('collector_launch_failed');
    }
  }

  private setState(state: SessionState) { this.current = { state, changedAt: new Date().toISOString() }; }

  private destroyQr() {
    this.qrSnapshot?.bytes.fill(0);
    this.qrSnapshot = null;
  }
}

function validQrPng(bytes: Buffer) {
  if (bytes.byteLength < 24 || bytes.byteLength > 1024 * 1024) return false;
  if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return false;
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return false;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 && width <= 1024 && height <= 1024;
}

async function launchPersistentChromium(options: LaunchOptions): Promise<BrowserHandle> {
  const context = await chromium.launchPersistentContext(options.profileDirectory, { headless: options.headless, channel: process.env.LOCAL_XHS_BROWSER_CHANNEL ?? 'chrome' });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    return { close: () => context.close(), page };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}
