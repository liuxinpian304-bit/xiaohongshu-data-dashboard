// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SelfImportLogin } from './self-import-login';

const accounts = [
  { id: '00000000-0000-4000-8000-000000000001', platformId: 'stable-user-1', xhsAccountId: 'red_123', displayName: '真实昵称', avatarUrl: null, identityVerifiedAt: '2026-08-04T00:00:00.000Z' },
  { id: '00000000-0000-4000-8000-000000000002', platformId: 'stable-user-2', xhsAccountId: 'red_456', displayName: '第二账号', avatarUrl: null, identityVerifiedAt: '2026-08-04T00:00:00.000Z' },
];

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('SelfImportLogin', () => {
  it('shows a real same-origin QR after starting login', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const state = init?.method === 'POST' ? 'awaiting_scan' : 'idle';
      return new Response(JSON.stringify({ state, changedAt: '2026-08-04T00:00:00.000Z', ...(state === 'awaiting_scan' ? { qrExpiresAt: '2026-08-04T00:02:00.000Z' } : {}) }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);
    render(<SelfImportLogin accounts={[]} />);

    await waitFor(() => expect(screen.getByRole('button', { name: '登录新账号' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '登录新账号' }));

    expect(await screen.findByRole('img', { name: '小红书登录二维码' })).toHaveAttribute('src', expect.stringMatching(/^\/api\/control\/local-collector\/qr\?v=/));
    expect(screen.queryByRole('button', { name: '我已扫码完成' })).not.toBeInTheDocument();
  });

  it('switches to connected state only after polling proves authentication', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      const state = calls === 1 ? 'awaiting_scan' : 'authenticated';
      return new Response(JSON.stringify({ state, changedAt: '2026-08-04T00:00:00.000Z', ...(state === 'awaiting_scan' ? { qrExpiresAt: '2026-08-04T00:02:00.000Z' } : { identityVerifiedAt: '2026-08-04T00:00:00.000Z', identity: { platformId: 'stable-user-1', xhsAccountId: 'red_123', displayName: '真实昵称', avatarUrl: null } }) }), { status: 200 });
    }));
    render(<SelfImportLogin accounts={accounts} />);

    expect(await screen.findByText('等待扫码')).toBeVisible();
    await waitFor(() => expect(screen.getByText('账号已连接')).toBeVisible(), { timeout: 3_000 });
    expect(screen.getByRole('heading', { name: '真实昵称' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '第二账号' })).toBeVisible();
    expect(screen.getByText('小红书号：red_123')).toBeVisible();
    expect(screen.getByRole('button', { name: '立即同步' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '登录此账号后同步' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '立即同步' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/control/local-collector/sync', expect.objectContaining({ body: JSON.stringify({ accountId: accounts[0].id }) })));
  });

  it('asks for a new scan after the persisted platform session expires', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: 'expired', changedAt: '2026-08-04T00:00:00.000Z' }), { status: 200 })));
    render(<SelfImportLogin accounts={accounts} />);

    expect(await screen.findByText('需要重新扫码')).toBeVisible();
    expect(screen.queryByText('账号已连接')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录新账号' })).toBeEnabled();
  });
});
