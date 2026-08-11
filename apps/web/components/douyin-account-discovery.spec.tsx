// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DouyinAccountDiscovery } from './douyin-account-discovery';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('DouyinAccountDiscovery', () => {
  it('shows the authenticated Douyin account discovered from Xiaohuohua', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [{ platform: 'douyin', platformId: 'visible:Tonic', displayName: 'Tonic', avatarUrl: null, loginState: 'authenticated', surfaceId: 'xiaohuohua:0' }] })));

    render(<DouyinAccountDiscovery />);

    expect(await screen.findByRole('heading', { name: 'Tonic' })).toBeVisible();
    expect(screen.getByText('抖音 · 登录有效')).toBeVisible();
  });
});
