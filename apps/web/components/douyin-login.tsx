'use client';

import React, { useEffect, useRef, useState } from 'react';

type Identity = { platformId: string; douyinAccountId: string; displayName: string; avatarUrl: string | null };
export type DouyinSession = { sessionId: string; state: 'idle' | 'launching' | 'awaiting_scan' | 'authenticated' | 'verification_required' | 'expired' | 'error' | 'closed'; changedAt: string; identity?: Identity; identityVerifiedAt?: string; qrExpiresAt?: string };

const labels: Record<DouyinSession['state'], string> = { idle: '等待启动', launching: '正在打开抖音创作中心', awaiting_scan: '等待扫码', authenticated: '登录有效', verification_required: '需要安全验证', expired: '二维码已过期', error: '登录异常', closed: '已关闭' };
const transitional = new Set<DouyinSession['state']>(['idle', 'launching', 'awaiting_scan', 'verification_required']);

export function DouyinLogin({ initialSessions, pollMilliseconds = 2_000 }: { initialSessions: DouyinSession[]; pollMilliseconds?: number }) {
  const [sessions, setSessions] = useState(initialSessions);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void fetch('/api/control/douyin/sessions', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { items?: DouyinSession[] };
      if (mounted.current && Array.isArray(body.items)) setSessions(body.items);
    }).catch(() => undefined);
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const active = sessions.filter((session) => transitional.has(session.state));
    if (!active.length) return;
    const timer = setTimeout(() => {
      void Promise.all(active.map(async (session) => {
        const response = await fetch(`/api/control/douyin/sessions/${session.sessionId}`, { cache: 'no-store' });
        return response.ok ? response.json() as Promise<DouyinSession> : session;
      })).then((updates) => {
        if (!mounted.current) return;
        setSessions((current) => current.map((session) => updates.find((candidate) => candidate.sessionId === session.sessionId) ?? session));
      }).catch(() => setMessage('抖音登录状态暂时无法更新，请稍后重试。'));
    }, pollMilliseconds);
    return () => clearTimeout(timer);
  }, [sessions, pollMilliseconds]);

  async function createSession() {
    setPending(true); setMessage('');
    try {
      const response = await fetch('/api/control/douyin/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error();
      const session = await response.json() as DouyinSession;
      setSessions((current) => [session, ...current.filter((candidate) => candidate.sessionId !== session.sessionId)]);
    } catch { setMessage('无法打开抖音登录，请确认本机采集服务正在运行。'); }
    finally { setPending(false); }
  }

  async function refresh(sessionId: string) {
    setMessage('');
    const response = await fetch(`/api/control/douyin/sessions/${sessionId}/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!response.ok) { setMessage('刷新抖音登录失败，请重试。'); return; }
    const status = await response.json() as DouyinSession;
    setSessions((current) => current.map((session) => session.sessionId === sessionId ? status : session));
  }

  async function close(sessionId: string) {
    const response = await fetch(`/api/control/douyin/sessions/${sessionId}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!response.ok) { setMessage('关闭抖音登录失败，请重试。'); return; }
    setSessions((current) => current.filter((session) => session.sessionId !== sessionId));
  }

  return <section className="xhs-account-login douyin-login" aria-labelledby="douyin-login-title">
    <div className="xhs-login-heading"><div><h2 id="douyin-login-title">抖音账号登录</h2><p>使用抖音 App 扫描官方创作中心二维码，每个账号使用独立会话保存登录状态。</p></div><button className="primary-button" type="button" disabled={pending} onClick={() => void createSession()}>{pending ? '正在打开…' : '登录新的抖音账号'}</button></div>
    {message ? <p className="xhs-login-message" role="alert">{message}</p> : null}
    <div className="douyin-session-grid">{sessions.map((session) => <article className="douyin-session-card" key={session.sessionId}>
      {session.identity?.avatarUrl ? <img className="account-avatar" src={session.identity.avatarUrl} alt="" width="72" height="72" referrerPolicy="no-referrer" /> : <span className="account-avatar account-avatar--placeholder">抖</span>}
      <div className="douyin-session-body"><strong>{session.identity?.displayName ?? labels[session.state]}</strong>{session.identity ? <span>抖音号：{session.identity.douyinAccountId}</span> : <span>{labels[session.state]}</span>}{session.identityVerifiedAt ? <small>身份核验：{new Date(session.identityVerifiedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</small> : null}</div>
      {session.state === 'awaiting_scan' ? <div className="douyin-qr"><img src={`/api/control/douyin/sessions/${session.sessionId}/qr?v=${encodeURIComponent(session.changedAt)}`} alt="抖音登录二维码" width="220" height="220" /><span>请使用抖音 App 扫码</span></div> : null}
      {session.state === 'verification_required' ? <p className="xhs-verification" role="alert">抖音要求安全验证，请在本机打开的官方窗口中亲自完成。</p> : null}
      <div className="account-actions">{session.state === 'authenticated' && session.identity ? <button className="primary-button" type="button" aria-label={`同步 ${session.identity.displayName}`}>立即同步</button> : <button className="secondary-button" type="button" onClick={() => void refresh(session.sessionId)}>刷新状态</button>}<button className="secondary-button" type="button" onClick={() => void close(session.sessionId)}>关闭会话</button></div>
    </article>)}</div>
  </section>;
}
