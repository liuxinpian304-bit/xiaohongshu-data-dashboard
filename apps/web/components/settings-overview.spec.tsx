// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsOverview } from './settings-overview';

afterEach(cleanup);

describe('SettingsOverview', () => {
  it('renders healthy services and the connected account entirely in Chinese', () => {
    render(<SettingsOverview status={{ api: 'healthy', database: 'healthy', collector: 'healthy', version: '41693aa', timezone: 'Asia/Shanghai', account: { displayName: '南瓜汤与瓜子仁', xhsAccountId: '95874286519', platformId: 'stable-id', avatarUrl: null, loginState: 'authenticated' } }} />);
    expect(screen.getAllByText('运行正常')).toHaveLength(4);
    expect(screen.getByText('南瓜汤与瓜子仁')).toBeInTheDocument();
    expect(screen.getByText('小红书号：95874286519')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往账号管理' })).toHaveAttribute('href', '/accounts');
    expect(document.body.textContent).not.toMatch(/password|token|cookie|database_url/i);
    expect(document.body.textContent).not.toContain('演示数据');
  });

  it('shows localized degraded and no-account states', () => {
    render(<SettingsOverview status={{ api: 'healthy', database: 'unhealthy', collector: 'disabled', version: '本地版本', timezone: 'Asia/Shanghai', account: null }} />);
    expect(screen.getByText('连接异常')).toBeInTheDocument();
    expect(screen.getByText('尚未启用')).toBeInTheDocument();
    expect(screen.getByText('尚未连接账号')).toBeInTheDocument();
  });
});
