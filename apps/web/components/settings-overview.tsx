import Link from 'next/link';
import React from 'react';
import type { SettingsHealth, SettingsStatus } from '../lib/api';

const healthLabel: Record<SettingsHealth, string> = { healthy: '运行正常', unhealthy: '连接异常', disabled: '尚未启用' };

export function SettingsOverview({ status }: { status: SettingsStatus }) {
  const services: Array<{ label: string; state: SettingsHealth; detail: string }> = [
    { label: '网页服务', state: 'healthy', detail: '管理页面可以正常访问' },
    { label: 'API 数据服务', state: status.api, detail: '负责读取和写入驾驶舱数据' },
    { label: '数据库', state: status.database, detail: '保存账号、笔记、评论和报表' },
    { label: '本地采集器', state: status.collector, detail: '负责连接已登录的小红书创作中心' },
  ];
  return <div className="settings-overview">
    <section className="settings-section"><div className="settings-section-heading"><div><h2>运行状态</h2><p>系统会分别检查每项服务，单项异常不会影响本页打开。</p></div></div><div className="settings-status-grid">{services.map(({ label, state, detail }) => <article key={label} data-state={state}><div><span className="settings-state-dot" aria-hidden="true"/><strong>{label}</strong></div><b>{healthLabel[state]}</b><p>{detail}</p></article>)}</div></section>
    <section className="settings-section"><div className="settings-section-heading"><div><h2>账号与登录</h2><p>这里只显示当前本机采集器核验到的登录身份。</p></div><Link className="secondary-button" href="/accounts">前往账号管理</Link></div>{status.account ? <div className="settings-account">{status.account.avatarUrl ? <img src={status.account.avatarUrl} alt="" width="60" height="60" referrerPolicy="no-referrer"/> : <span aria-hidden="true">{status.account.displayName.slice(0, 1)}</span>}<div><strong>{status.account.displayName}</strong><p>小红书号：{status.account.xhsAccountId || status.account.platformId}</p><small>登录有效</small></div></div> : <div className="settings-empty"><strong>尚未连接账号</strong><span>请前往账号管理，使用小红书 App 扫码登录。</span></div>}</section>
    <section className="settings-section"><div className="settings-section-heading"><div><h2>数据源</h2><p>不同来源的数据会始终分开标记。</p></div></div><div className="settings-source-grid"><article><strong>账号自抓数据</strong><span>当前真实数据入口，读取你本人已登录账号的笔记和评论。</span></article><article><strong>官方 API</strong><span>接口入口已保留，平台审批通过后启用。</span></article><article><strong>演示数据</strong><span>只用于界面和操作流程演示，不代表真实账号数据。</span></article></div></section>
    <section className="settings-section"><div className="settings-section-heading"><div><h2>系统信息</h2><p>本页不会显示密码、令牌或数据库连接信息。</p></div></div><dl className="settings-info"><div><dt>应用版本</dt><dd>{status.version}</dd></div><div><dt>系统时区</dt><dd>{status.timezone}</dd></div><div><dt>数据存储</dt><dd>本机数据库</dd></div></dl></section>
  </div>;
}
