// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from './app-shell';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
afterEach(() => { cleanup(); document.body.style.overflow = ''; });

describe('AppShell mobile drawer', () => {
  it('opens as a modal dialog, traps focus, closes with Escape, and restores focus', () => {
    render(<AppShell><p>内容</p></AppShell>);
    const trigger = screen.getByRole('button', { name: '打开导航' });

    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '全部功能' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus();
    expect(document.body).toHaveStyle({ overflow: 'hidden' });

    const settings = within(dialog).getByRole('link', { name: '设置' });
    settings.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' });
  });
});
