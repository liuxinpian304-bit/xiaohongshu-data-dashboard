import { chmod, mkdir } from 'node:fs/promises';

import { chromium } from 'playwright';

export type SessionState = 'idle' | 'launching' | 'browser_open' | 'user_confirmed' | 'closed' | 'error';
export interface SessionStatus { state: SessionState; changedAt: string; errorCode?: 'collector_launch_failed' }
interface BrowserHandle { close(): Promise<void> }
interface LaunchOptions { profileDirectory: string; headless: false; url: string }

export interface SessionManagerOptions {
  profileDirectory: string;
  launch?: (options: LaunchOptions) => Promise<BrowserHandle>;
}

export class LocalXhsSessionManager {
  private handle: BrowserHandle | null = null;
  private current: SessionStatus = { state: 'idle', changedAt: new Date().toISOString() };
  private launching: Promise<SessionStatus> | null = null;

  constructor(private readonly options: SessionManagerOptions) {}

  status(): SessionStatus { return { ...this.current }; }

  async start() {
    if (this.current.state === 'browser_open' || this.current.state === 'user_confirmed') return this.status();
    if (this.launching) return this.launching;
    this.setState('launching');
    this.launching = this.launch().finally(() => { this.launching = null; });
    return this.launching;
  }

  confirm() {
    if (this.current.state !== 'browser_open' && this.current.state !== 'user_confirmed') throw new Error('collector_session_not_open');
    this.setState('user_confirmed');
    return this.status();
  }

  async close() {
    const handle = this.handle;
    this.handle = null;
    if (handle) await handle.close();
    this.setState('closed');
    return this.status();
  }

  private async launch() {
    try {
      await mkdir(this.options.profileDirectory, { recursive: true, mode: 0o700 });
      await chmod(this.options.profileDirectory, 0o700);
      const launch = this.options.launch ?? launchPersistentChromium;
      this.handle = await launch({ profileDirectory: this.options.profileDirectory, headless: false, url: 'https://www.xiaohongshu.com/' });
      this.setState('browser_open');
      return this.status();
    } catch {
      this.current = { state: 'error', changedAt: new Date().toISOString(), errorCode: 'collector_launch_failed' };
      throw new Error('collector_launch_failed');
    }
  }

  private setState(state: SessionState) { this.current = { state, changedAt: new Date().toISOString() }; }
}

async function launchPersistentChromium(options: LaunchOptions): Promise<BrowserHandle> {
  const context = await chromium.launchPersistentContext(options.profileDirectory, { headless: options.headless, channel: process.env.LOCAL_XHS_BROWSER_CHANNEL ?? 'chrome' });
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  return { close: () => context.close() };
}
