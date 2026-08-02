'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

type NavItem = { href: string; label: string; icon: IconName };
type IconName = 'overview' | 'account' | 'job' | 'note' | 'comment' | 'report' | 'notification' | 'settings' | 'menu';

const navigation: NavItem[] = [
  { href: '/dashboard', label: '总览', icon: 'overview' },
  { href: '/accounts', label: '账号', icon: 'account' },
  { href: '/jobs', label: '任务', icon: 'job' },
  { href: '/notes', label: '笔记', icon: 'note' },
  { href: '/comments', label: '评论', icon: 'comment' },
  { href: '/reports', label: '报告', icon: 'report' },
  { href: '/notifications', label: '通知', icon: 'notification' },
];

const mobilePrimary = navigation.filter(({ href }) => ['/dashboard', '/accounts', '/comments', '/reports'].includes(href));

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    overview: <><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z" /></>,
    account: <><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6" /></>,
    job: <><rect x="5" y="5" width="14" height="15" rx="2" /><path d="M9 5V3h6v2M9 11l2 2 4-4M9 17h6" /></>,
    note: <><path d="M6 3h9l4 4v14H6V3Z" /><path d="M15 3v5h4M9 13h6M9 17h6" /></>,
    comment: <><path d="M4 5h16v11H9l-5 4V5Z" /><path d="M8 10h.01M12 10h.01M16 10h.01" /></>,
    report: <><path d="M5 21V4h14v17H5Z" /><path d="M9 17v-4M12 17V8M15 17v-6" /></>,
    notification: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8ZM10 21h4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5l-.4 3.1a8 8 0 0 0-1.7 1l-2.4-1-2 3.4L5.1 11a7 7 0 0 0 0 2L3 14.5l2 3.4 2.4-1a8 8 0 0 0 1.7 1l.4 3.1h5l.4-3.1a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2.1-1.5a7 7 0 0 0 .1-1Z" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  };
  return <svg aria-hidden="true" className="nav-icon" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
  return (
    <Link className="nav-link" data-active={active} href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined}>
      <Icon name={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);

  const openDrawer = (trigger: HTMLButtonElement) => {
    lastTriggerRef.current = trigger;
    setDrawerOpen(true);
  };

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      lastTriggerRef.current?.focus();
    };
  }, [drawerOpen]);

  const handleDrawerKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setDrawerOpen(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主导航" aria-hidden={drawerOpen || undefined} inert={drawerOpen || undefined}>
        <Link className="brand" href="/dashboard" aria-label="数据驾驶舱总览"><span className="brand-mark" />数据驾驶舱</Link>
        <nav className="sidebar-nav">{navigation.map((item) => <NavLink item={item} key={item.href} />)}</nav>
        <NavLink item={{ href: '/settings', label: '设置', icon: 'settings' }} />
      </aside>

      <header className="mobile-header" aria-hidden={drawerOpen || undefined} inert={drawerOpen || undefined}>
        <button className="icon-button" type="button" onClick={(event) => openDrawer(event.currentTarget)} aria-label="打开导航" aria-expanded={drawerOpen} aria-controls="mobile-navigation-dialog"><Icon name="menu" /></button>
        <strong>数据驾驶舱</strong>
        <Link className="icon-button" href="/notifications" aria-label="查看通知"><Icon name="notification" /></Link>
      </header>

      {drawerOpen ? (
        <div className="drawer-layer">
          <button className="drawer-backdrop" aria-label="关闭导航" onClick={() => setDrawerOpen(false)} />
          <aside id="mobile-navigation-dialog" className="drawer" role="dialog" aria-modal="true" aria-labelledby="mobile-navigation-title" onKeyDown={handleDrawerKeyDown}>
            <div className="drawer-heading"><strong id="mobile-navigation-title">全部功能</strong><button ref={closeButtonRef} type="button" onClick={() => setDrawerOpen(false)} aria-label="关闭">×</button></div>
            <nav>{navigation.map((item) => <NavLink item={item} key={item.href} onNavigate={() => setDrawerOpen(false)} />)}<NavLink item={{ href: '/settings', label: '设置', icon: 'settings' }} onNavigate={() => setDrawerOpen(false)} /></nav>
          </aside>
        </div>
      ) : null}

      <main className="workspace" aria-hidden={drawerOpen || undefined} inert={drawerOpen || undefined}>{children}</main>

      <nav className="bottom-nav" aria-label="移动端主导航" aria-hidden={drawerOpen || undefined} inert={drawerOpen || undefined}>
        {mobilePrimary.map((item) => <NavLink item={item} key={item.href} />)}
        <button className="nav-link" type="button" onClick={(event) => openDrawer(event.currentTarget)} aria-expanded={drawerOpen} aria-controls="mobile-navigation-dialog"><Icon name="overview" /><span>更多</span></button>
      </nav>
    </div>
  );
}
