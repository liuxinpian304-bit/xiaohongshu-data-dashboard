'use client';

import React, { useCallback, useEffect, useState } from 'react';

type SessionState = 'idle' | 'launching' | 'awaiting_scan' | 'authenticated' | 'verification_required' | 'expired' | 'closed' | 'error';
type SessionIdentity = { platformId: string; xhsAccountId: string | null; displayName: string; avatarUrl: string | null };
type SessionStatus = { state: SessionState; changedAt: string; qrExpiresAt?: string; errorCode?: string; identity?: SessionIdentity; identityVerifiedAt?: string };
type SyncStage = 'account' | 'notes' | 'metrics' | 'comments' | 'replies' | 'writing' | 'reports' | 'complete';
type SyncStatus = { runId: string | null; state: 'idle' | 'running' | 'completed' | 'failed'; stage: SyncStage; processed: number; total: number; incompleteNotes: number; changedAt: string; errorCode?: string };

const labels: Record<SessionState, string> = {
  idle: '尚未启动', launching: '正在准备登录…', awaiting_scan: '等待扫码', authenticated: '账号已连接',
  verification_required: '需要你完成平台验证', expired: '需要重新扫码', closed: '登录窗口已关闭', error: '登录服务异常',
};
const stageLabels: Record<SyncStage, string> = {
  account: '账号', notes: '笔记', metrics: '指标', comments: '评论', replies: '回复', writing: '写入', reports: '报表重建', complete: '完成',
};

export function SelfImportLogin() {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);

  const readJson = useCallback(async <T,>(response: Response): Promise<T> => {
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : '操作失败');
    return body as T;
  }, []);

  const refreshStatus = useCallback(async (verify = false) => {
    const path = verify ? '/api/control/local-collector/refresh' : '/api/control/local-collector/status';
    const response = await fetch(path, verify ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } : { cache: 'no-store' });
    if (response.status === 503) { setMessage('本机登录服务尚未启动，请先启动 Collector。'); return; }
    setStatus(await readJson<SessionStatus>(response));
  }, [readJson]);

  const refreshSync = useCallback(async () => {
    const response = await fetch('/api/control/local-collector/sync-status', { cache: 'no-store' });
    if (response.ok) setSync(await readJson<SyncStatus>(response));
  }, [readJson]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);
  useEffect(() => {
    if (!status || !['launching', 'awaiting_scan', 'verification_required'].includes(status.state)) return;
    const timer = window.setInterval(() => { void refreshStatus(true); }, 2_000);
    return () => window.clearInterval(timer);
  }, [refreshStatus, status]);
  useEffect(() => {
    if (sync?.state !== 'running') return;
    const timer = window.setInterval(() => { void refreshSync(); }, 2_000);
    return () => window.clearInterval(timer);
  }, [refreshSync, sync?.state]);
  useEffect(() => {
    if (!status?.qrExpiresAt || status.state !== 'awaiting_scan') { setSecondsLeft(0); return; }
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((new Date(status.qrExpiresAt!).getTime() - Date.now()) / 1_000)));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [status?.qrExpiresAt, status?.state]);

  const action = async (name: 'start' | 'close' | 'sync') => {
    setPending(true); setMessage('');
    try {
      const response = await fetch(`/api/control/local-collector/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (name === 'sync') setSync(await readJson<SyncStatus>(response));
      else setStatus(await readJson<SessionStatus>(response));
    } catch { setMessage('操作失败，请确认本机 Collector、API 和网页服务均已启动。'); }
    finally { setPending(false); }
  };

  const showQr = status?.state === 'awaiting_scan';
  return <section className="xhs-login-card" aria-labelledby="self-login-title">
    <div className="xhs-login-copy"><strong id="self-login-title">驾驶舱内登录小红书</strong><span>二维码由本机 Collector 从小红书创作服务平台实时获取；登录凭据不会进入网页或数据库。</span></div>
    <div className="xhs-login-state" aria-live="polite"><strong>{status ? labels[status.state] : '正在检查…'}</strong>{showQr ? <span>{secondsLeft > 0 ? `二维码剩余 ${secondsLeft} 秒` : '正在刷新二维码…'}</span> : null}{message ? <span role="alert">{message}</span> : null}</div>
    {showQr ? <div className="xhs-qr-panel"><img src={`/api/control/local-collector/qr?v=${encodeURIComponent(status.changedAt)}`} alt="小红书登录二维码" width="240" height="240" /><span>请使用小红书 App 扫码</span></div> : null}
    {status?.state === 'authenticated' && status.identity ? <div className="xhs-account-identity">
      {status.identity.avatarUrl ? <img src={status.identity.avatarUrl} alt="" width="56" height="56" referrerPolicy="no-referrer" /> : <span className="xhs-account-avatar" aria-hidden="true">{status.identity.displayName.slice(0, 1)}</span>}
      <div><h2>{status.identity.displayName}</h2><span>小红书号：{status.identity.xhsAccountId ?? status.identity.platformId}</span><small>登录有效</small></div>
    </div> : null}
    {status?.state === 'verification_required' ? <p className="xhs-verification" role="alert">平台要求安全验证，请在本机受控验证窗口中亲自完成；系统不会绕过验证。</p> : null}
    {sync ? <div className="xhs-sync-progress" aria-live="polite"><strong>{sync.state === 'completed' ? '同步完成' : sync.state === 'failed' ? '同步失败' : `正在处理：${stageLabels[sync.stage]}`}</strong><span>{sync.processed}/{sync.total || '—'} · 不完整笔记 {sync.incompleteNotes}</span></div> : null}
    <div className="action-row">
      {!status || ['idle', 'closed', 'expired', 'error'].includes(status.state) ? <button type="button" disabled={pending} onClick={() => void action('start')}>{status?.state === 'expired' ? '重新扫码登录' : '在驾驶舱登录小红书'}</button> : null}
      {status?.state === 'authenticated' ? <button type="button" disabled={pending || sync?.state === 'running'} onClick={() => void action('sync')}>立即同步</button> : null}
      {status && ['awaiting_scan', 'authenticated', 'verification_required'].includes(status.state) ? <button type="button" disabled={pending} onClick={() => void action('close')}>关闭本机会话</button> : null}
    </div>
  </section>;
}
