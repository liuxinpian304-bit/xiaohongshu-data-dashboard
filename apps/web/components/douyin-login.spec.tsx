// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DouyinLogin } from './douyin-login';

afterEach(() => vi.restoreAllMocks());

describe('DouyinLogin', () => {
  it('shows the official QR and verified identity instead of a fake placeholder', async () => {
    const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    let statusCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/sessions') && init?.method !== 'POST') return Response.json({ items: [] });
      if (url.endsWith('/sessions') && init?.method === 'POST') return Response.json({ sessionId, state: 'awaiting_scan', changedAt: '2026-08-11T06:00:00.000Z', qrExpiresAt: '2026-08-11T06:02:00.000Z' }, { status: 201 });
      if (url.endsWith(`/sessions/${sessionId}`)) {
        statusCalls += 1;
        return Response.json({ sessionId, state: 'authenticated', changedAt: '2026-08-11T06:00:03.000Z', identityVerifiedAt: '2026-08-11T06:00:03.000Z', identity: { platformId: 'douyin:7390000000000000000', douyinAccountId: 'tonic123', displayName: 'Tonic', avatarUrl: null } });
      }
      throw new Error(`unexpected request ${url}`);
    }));

    render(<DouyinLogin initialSessions={[]} pollMilliseconds={1} />);
    fireEvent.click(screen.getByRole('button', { name: '登录新的抖音账号' }));

    expect(await screen.findByRole('img', { name: '抖音登录二维码' })).toHaveAttribute('src', expect.stringContaining(`/api/control/douyin/sessions/${sessionId}/qr`));
    expect(await screen.findByText('Tonic')).toBeVisible();
    expect(screen.getByText('抖音号：tonic123')).toBeVisible();
    expect(screen.getByRole('button', { name: '同步 Tonic' })).toBeVisible();
    expect(screen.queryByText('已通过小火花连接')).not.toBeInTheDocument();
    expect(statusCalls).toBeGreaterThan(0);
  });

  it('starts a real account-scoped sync and reports completion', async () => {
    const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const session = { sessionId, state: 'authenticated' as const, changedAt: '2026-08-11T06:00:03.000Z', identityVerifiedAt: '2026-08-11T06:00:03.000Z', identity: { platformId: 'douyin:7390000000000000000', douyinAccountId: 'YPSJ0725', displayName: 'P', avatarUrl: null } };
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/sessions') && init?.method !== 'POST') return Response.json({ items: [session] });
      if (url.endsWith('/collection/start')) return Response.json({ runId: 'run-1', state: 'running', stage: 'account', processed: 0, total: 0 });
      if (url.endsWith('/collection/status')) return Response.json({ runId: 'run-1', state: 'completed', stage: 'complete', processed: 3, total: 3 });
      throw new Error(`unexpected request ${url}`);
    }));

    render(<DouyinLogin initialSessions={[session]} pollMilliseconds={1} />);
    fireEvent.click(screen.getByRole('button', { name: '同步 P' }));
    expect(await screen.findByText('同步完成，已处理 3 条抖音作品。')).toBeVisible();
  });
});
