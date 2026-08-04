'use client';

import { useCallback, useEffect, useState } from 'react';

type State = 'idle' | 'launching' | 'browser_open' | 'user_confirmed' | 'closed' | 'error';
type Status = { state: State; changedAt: string; errorCode?: string };

const labels: Record<State, string> = {
  idle: '尚未启动', launching: '正在打开 Chrome…', browser_open: '等待你在 Chrome 扫码', user_confirmed: '已确认登录', closed: '浏览器已关闭', error: '启动失败',
};

export function SelfImportLogin() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = useCallback(async () => {
    const response = await fetch('/api/control/local-collector/status', { cache: 'no-store' });
    if (response.ok) setStatus(await response.json());
    else if (response.status === 503) setMessage('本机登录服务尚未启动，请先启动 Collector。');
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!status || !['launching', 'browser_open'].includes(status.state)) return;
    const timer = window.setInterval(() => { void refresh(); }, 2_000);
    return () => window.clearInterval(timer);
  }, [refresh, status]);

  const action = async (name: 'start' | 'confirm' | 'close') => {
    setPending(true); setMessage('');
    try {
      const response = await fetch(`/api/control/local-collector/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '操作失败');
      setStatus(body);
    } catch { setMessage('操作失败，请确认本机 Collector 已启动。'); }
    finally { setPending(false); }
  };

  return <section className="source-notice" aria-labelledby="self-login-title">
    <div><strong id="self-login-title">真实小红书扫码登录</strong><span>将在本机打开独立 Chrome。请在小红书真实页面亲自扫码，登录状态只保存在这台 Mac。</span></div>
    <div className="source-stack" aria-live="polite"><strong>{status ? labels[status.state] : '正在检查…'}</strong>{message ? <span role="alert">{message}</span> : null}</div>
    <div className="action-row">
      <button type="button" disabled={pending || status?.state === 'launching' || status?.state === 'browser_open'} onClick={() => void action('start')}>打开扫码登录</button>
      <button type="button" disabled={pending || status?.state !== 'browser_open'} onClick={() => void action('confirm')}>我已扫码完成</button>
      <button type="button" disabled={pending || !status || !['browser_open', 'user_confirmed'].includes(status.state)} onClick={() => void action('close')}>关闭登录窗口</button>
    </div>
  </section>;
}
