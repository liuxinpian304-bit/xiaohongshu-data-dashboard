import React from 'react';
import { redirect } from 'next/navigation';

import { SelfImportLogin } from '../../../components/self-import-login';
import { getAccounts } from '../../../lib/api';

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const result = await getAccounts(cursor);
  if (result.status === 'unauthorized') redirect('/login?next=/accounts');

  const items = result.status === 'ok' ? result.data.items : [];
  const realAccounts = items.filter((account) => account.connectorType === 'self-scrape');

  return <div className="workflow-page">
    <header className="workflow-heading"><div><h1>账号</h1><p>管理已登录的小红书账号，并为每个账号独立同步真实数据。</p></div></header>
    <SelfImportLogin accounts={realAccounts.map(({ id, platformId, xhsAccountId, displayName, avatarUrl, identityVerifiedAt }) => ({ id, platformId, xhsAccountId, displayName, avatarUrl, identityVerifiedAt }))} />
    <section className="source-notice"><strong>账号自抓数据</strong><span>当前真实数据由本机已登录的小红书账号同步。</span></section>
    <section className="source-notice"><strong>官方 API 尚未配置</strong><span>当前不会请求任何未公开接口；获批后可在此接入。</span></section>
    {result.status === 'error' ? <section className="load-error" role="alert"><h2>账号暂时无法加载</h2><p>{result.message}</p><a href="/accounts">重新加载</a></section> : realAccounts.length ? <section className="workflow-list">{realAccounts.map((account) => <article key={account.id}>
      {account.avatarUrl ? <img className="account-list-avatar" src={account.avatarUrl} alt="" width="48" height="48" referrerPolicy="no-referrer" /> : null}
      <div><h2>{account.displayName || account.platformId}</h2><p>小红书号：{account.xhsAccountId || account.platformId}</p>{account.identityVerifiedAt ? <small>身份核验：{new Date(account.identityVerifiedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</small> : null}</div>
      <div className="source-stack"><strong>账号自抓数据</strong><span>真实账号资料已保存；登录状态以上方实时检测为准</span></div>
    </article>)}</section> : <section className="workflow-empty"><strong>还没有可管理的账号</strong><span>首次扫码并完成身份核验后会显示在这里。</span></section>}
  </div>;
}
