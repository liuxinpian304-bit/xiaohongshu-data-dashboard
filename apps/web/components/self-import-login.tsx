'use client';

import React, { useCallback, useEffect, useState } from 'react';

type SessionState = 'idle' | 'launching' | 'awaiting_scan' | 'authenticated' | 'verification_required' | 'expired' | 'closed' | 'error';
type SessionIdentity = { platformId: string; xhsAccountId: string | null; displayName: string; avatarUrl: string | null };
type SessionStatus = { state: SessionState; changedAt: string; qrExpiresAt?: string; errorCode?: string; identity?: SessionIdentity; identityVerifiedAt?: string };
type SyncStage = 'account' | 'notes' | 'metrics' | 'comments' | 'replies' | 'writing' | 'reports' | 'complete';
type SyncStatus = { runId: string | null; state: 'idle' | 'running' | 'completed' | 'failed'; stage: SyncStage; processed: number; total: number; incompleteNotes: number; changedAt: string; errorCode?: string };
export type LoginAccount = { id: string; platformId: string; xhsAccountId: string | null; displayName: string | null; avatarUrl: string | null; identityVerifiedAt: string | null };

const labels: Record<SessionState, string> = { idle: '尚未启动', launching: '正在准备登录…', awaiting_scan: '等待扫码', authenticated: '账号已连接', verification_required: '需要完成平台验证', expired: '需要重新扫码', closed: '登录窗口已关闭', error: '登录服务异常' };
const stageLabels: Record<SyncStage, string> = { account: '账号', notes: '笔记', metrics: '指标', comments: '评论', replies: '回复', writing: '写入', reports: '报表重建', complete: '完成' };

export function SelfImportLogin({ accounts = [] }: { accounts?: LoginAccount[] }) {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);

  const readJson = useCallback(async <T,>(response: Response): Promise<T> => { const body = await response.json(); if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : '操作失败'); return body as T; }, []);
  const request = useCallback(async (name: 'start' | 'refresh' | 'close', body = '{}') => readJson<SessionStatus>(await fetch(`/api/control/local-collector/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })), [readJson]);
  const refreshStatus = useCallback(async (verify = false) => { const response = await fetch(verify ? '/api/control/local-collector/refresh' : '/api/control/local-collector/status', verify ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } : { cache: 'no-store' }); if (response.status === 503) { setMessage('本机登录服务尚未启动，请先启动采集器。'); return; } setStatus(await readJson<SessionStatus>(response)); }, [readJson]);
  const refreshSync = useCallback(async () => { const response = await fetch('/api/control/local-collector/sync-status', { cache: 'no-store' }); if (response.ok) setSync(await readJson<SyncStatus>(response)); }, [readJson]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);
  useEffect(() => { if (!status || !['launching', 'awaiting_scan', 'verification_required'].includes(status.state)) return; const timer = window.setInterval(() => { void refreshStatus(true); }, 2_000); return () => window.clearInterval(timer); }, [refreshStatus, status]);
  useEffect(() => { if (sync?.state !== 'running') return; const timer = window.setInterval(() => { void refreshSync(); }, 2_000); return () => window.clearInterval(timer); }, [refreshSync, sync?.state]);
  useEffect(() => { if (!status?.qrExpiresAt || status.state !== 'awaiting_scan') { setSecondsLeft(0); return; } const update = () => setSecondsLeft(Math.max(0, Math.ceil((new Date(status.qrExpiresAt!).getTime() - Date.now()) / 1_000))); update(); const timer = window.setInterval(update, 1_000); return () => window.clearInterval(timer); }, [status?.qrExpiresAt, status?.state]);

  async function beginLogin() {
    setPending(true); setMessage(''); setLoginOpen(true);
    try { if (status?.state === 'authenticated') await request('close'); setStatus(await request('start')); }
    catch { setMessage('登录启动失败，请确认本机采集器、API 和网页服务均已启动。'); }
    finally { setPending(false); }
  }

  async function syncAccount(accountId: string) {
    setPending(true); setMessage(''); setSyncingAccountId(accountId);
    try { const response = await fetch('/api/control/local-collector/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId }) }); setSync(await readJson<SyncStatus>(response)); }
    catch { setMessage('同步失败：当前登录身份与所选账号不一致，请重新登录该账号。'); setSyncingAccountId(null); }
    finally { setPending(false); }
  }

  const currentPlatformId = status?.state === 'authenticated' ? status.identity?.platformId : null;
  const showQr = loginOpen && status?.state === 'awaiting_scan';
  return <section className="xhs-account-login" aria-labelledby="self-login-title">
    <div className="xhs-login-heading"><div><h2 id="self-login-title">已登录账号</h2><p>每个账号独立同步；同步前会核验当前小红书登录身份。</p></div><span aria-live="polite">{status ? labels[status.state] : '正在检查…'}</span></div>
    <div className="xhs-account-card-grid">
      {accounts.map((account) => { const matches = currentPlatformId === account.platformId; const accountSync = syncingAccountId === account.id ? sync : null; return <article className="xhs-account-card" key={account.id} data-current={matches || undefined}>
        {account.avatarUrl ? <img src={account.avatarUrl} alt="" width="72" height="72" referrerPolicy="no-referrer"/> : <span className="xhs-card-avatar" aria-hidden="true">{(account.displayName || account.platformId).slice(0, 1)}</span>}
        <h3>{account.displayName || account.platformId}</h3><p>小红书号：{account.xhsAccountId || account.platformId}</p><small>{matches ? '登录有效' : currentPlatformId ? '当前未登录此账号' : '登录状态待确认'}</small>
        <button type="button" disabled={pending || accountSync?.state === 'running'} onClick={() => matches ? void syncAccount(account.id) : void beginLogin()}>{matches ? '立即同步' : '登录此账号后同步'}</button>
        {accountSync ? <div className="xhs-card-progress" aria-live="polite"><strong>{accountSync.state === 'completed' ? '同步完成' : accountSync.state === 'failed' ? '同步失败' : `正在处理：${stageLabels[accountSync.stage]}`}</strong><span>{accountSync.processed}/{accountSync.total || '—'} · 不完整笔记 {accountSync.incompleteNotes}</span></div> : null}
      </article>; })}
      <article className="xhs-account-card xhs-add-account-card"><span className="xhs-add-icon" aria-hidden="true">＋</span><h3>登录新账号</h3><p>使用小红书 App 扫码添加账号</p><button type="button" disabled={pending} onClick={() => void beginLogin()}>登录新账号</button></article>
    </div>
    {loginOpen ? <div className="xhs-login-panel"><div><strong>{status ? labels[status.state] : '正在准备登录…'}</strong>{showQr ? <span>{secondsLeft > 0 ? `二维码剩余 ${secondsLeft} 秒` : '正在刷新二维码…'}</span> : null}</div>{message ? <p role="alert">{message}</p> : null}{showQr ? <div className="xhs-qr-panel"><img src={`/api/control/local-collector/qr?v=${encodeURIComponent(status.changedAt)}`} alt="小红书登录二维码" width="240" height="240"/><span>请使用小红书 App 扫码</span></div> : null}{status?.state === 'verification_required' ? <p className="xhs-verification" role="alert">平台要求安全验证，请在本机受控验证窗口中亲自完成。</p> : null}<button className="secondary-button" type="button" disabled={pending} onClick={() => { setLoginOpen(false); if (status && ['awaiting_scan', 'authenticated', 'verification_required'].includes(status.state)) void request('close').then(setStatus); }}>收起登录区</button></div> : null}
    {!loginOpen && message ? <p className="xhs-login-message" role="alert">{message}</p> : null}
  </section>;
}
