// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DouyinAccountDiscovery } from './douyin-account-discovery';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('DouyinAccountDiscovery', () => {
  it('never describes an unverified Xiaohuohua label as logged in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [{ platform: 'douyin', platformId: 'visible:Tonic', displayName: 'Tonic', avatarUrl: null, loginState: 'authenticated', surfaceId: 'xiaohuohua:0' }] })));

    render(<DouyinAccountDiscovery />);

    expect(await screen.findByText(/需要通过抖音官方页面扫码核验/)).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Tonic' })).not.toBeInTheDocument();
    expect(screen.queryByText('抖音 · 登录有效')).not.toBeInTheDocument();
  });
});
