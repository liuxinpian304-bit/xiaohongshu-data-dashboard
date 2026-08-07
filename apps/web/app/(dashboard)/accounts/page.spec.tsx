// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AccountsPage from './page';

vi.stubGlobal('React', React);

vi.mock('next/navigation', () => ({ redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../../lib/api', () => ({
  getAccounts: vi.fn().mockResolvedValue({
    status: 'ok',
    data: {
      items: [
        { id: '00000000-0000-4000-8000-000000000001', connectorType: 'self-scrape', platformId: 'real-platform', xhsAccountId: '95874286519', displayName: '南瓜汤与瓜子仁', avatarUrl: null, identityVerifiedAt: '2026-08-07T00:00:00.000Z', capabilities: [] },
        { id: '00000000-0000-4000-8000-000000000002', connectorType: 'mock', platformId: 'demo-platform', xhsAccountId: null, displayName: '测试账号', avatarUrl: null, identityVerifiedAt: null, capabilities: [] },
      ],
      pageInfo: { hasMore: false, nextCursor: null },
    },
  }),
}));
vi.mock('../../../components/self-import-login', () => ({ SelfImportLogin: () => <section aria-label="真实账号登录区" /> }));

afterEach(cleanup);

describe('AccountsPage', () => {
  it('shows only real account management and keeps the official API placeholder', async () => {
    render(await AccountsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText('南瓜汤与瓜子仁')).toBeInTheDocument();
    expect(screen.getAllByText('官方 API 尚未配置').length).toBeGreaterThan(0);
    expect(screen.queryByText('演示授权')).not.toBeInTheDocument();
    expect(screen.queryByText('演示连接器')).not.toBeInTheDocument();
    expect(screen.queryByText('创建演示账号')).not.toBeInTheDocument();
    expect(screen.queryByText('测试账号')).not.toBeInTheDocument();
  });
});
