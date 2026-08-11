'use client';

import React, { useEffect, useState } from 'react';

type Account = { platform: 'douyin'; platformId: string; displayName: string; avatarUrl: string | null; loginState: 'authenticated'; surfaceId: string };

export function DouyinAccountDiscovery() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/control/local-collector/accounts', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable');
        const body = await response.json() as { items?: Account[] };
        setAccounts((body.items ?? []).filter((account) => account.platform === 'douyin'));
        setState('ready');
      })
      .catch((error) => { if (error instanceof Error && error.name !== 'AbortError') setState('unavailable'); });
    return () => controller.abort();
  }, []);

  return <section className="workflow-section" aria-label="抖音账号">
    <div className="workflow-heading"><div><h2>抖音账号</h2><p>来自本机小火花的实时登录状态。</p></div></div>
    {accounts.length ? <div className="xhs-account-grid">{accounts.map((account) => <article className="xhs-account-card" key={account.surfaceId}>
      <div className="xhs-account-avatar" aria-hidden="true">{account.displayName.slice(0, 1)}</div>
      <div><h3>{account.displayName}</h3><p>抖音 · 登录有效</p><small>已通过小火花连接</small></div>
    </article>)}</div> : <p role="status">{state === 'loading' ? '正在读取小火花账号…' : state === 'unavailable' ? '小火花连接暂时不可用' : '小火花中未发现已登录的抖音账号'}</p>}
  </section>;
}
