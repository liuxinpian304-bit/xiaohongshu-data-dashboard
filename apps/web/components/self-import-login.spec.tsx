// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SelfImportLogin } from './self-import-login';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('SelfImportLogin', () => {
  it('shows a real same-origin QR after starting login', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const state = init?.method === 'POST' ? 'awaiting_scan' : 'idle';
      return new Response(JSON.stringify({ state, changedAt: '2026-08-04T00:00:00.000Z', ...(state === 'awaiting_scan' ? { qrExpiresAt: '2026-08-04T00:02:00.000Z' } : {}) }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);
    render(<SelfImportLogin />);

    await waitFor(() => expect(screen.getByRole('button', { name: '在驾驶舱登录小红书' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '在驾驶舱登录小红书' }));

    expect(await screen.findByRole('img', { name: '小红书登录二维码' })).toHaveAttribute('src', expect.stringMatching(/^\/api\/control\/local-collector\/qr\?v=/));
    expect(screen.queryByRole('button', { name: '我已扫码完成' })).not.toBeInTheDocument();
  });

  it('switches to connected state only after polling proves authentication', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      const state = calls === 1 ? 'awaiting_scan' : 'authenticated';
      return new Response(JSON.stringify({ state, changedAt: '2026-08-04T00:00:00.000Z', ...(state === 'awaiting_scan' ? { qrExpiresAt: '2026-08-04T00:02:00.000Z' } : {}) }), { status: 200 });
    }));
    render(<SelfImportLogin />);

    expect(await screen.findByText('等待扫码')).toBeVisible();
    await waitFor(() => expect(screen.getByText('账号已连接')).toBeVisible(), { timeout: 3_000 });
    expect(screen.getByRole('button', { name: '立即同步' })).toBeEnabled();
  });
});
