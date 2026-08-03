'use client';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';

function LoginForm() {
  const params = useSearchParams(); const [state, setState] = useState<'idle'|'loading'|'error'>('idle');
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setState('loading'); const password = new FormData(event.currentTarget).get('password'); const response = await fetch('/api/session/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) }); if (response.ok) { location.assign(params.get('next')?.startsWith('/') ? params.get('next')! : '/dashboard'); return; } setState('error'); }
  return <main className="login-page"><section className="login-card"><span className="brand-mark" aria-hidden="true" /><h1>登录数据驾驶舱</h1><p>仅限管理员使用。密码只用于本次登录，不会保存在浏览器。</p><form onSubmit={submit}><label htmlFor="password">管理员密码</label><input autoComplete="current-password" id="password" name="password" required type="password" /><button disabled={state === 'loading'} type="submit">{state === 'loading' ? '正在验证…' : '登录'}</button>{state === 'error' ? <p className="form-error" role="alert">密码不正确或服务暂时不可用，请重试。</p> : null}</form></section></main>;
}
export default function LoginPage() { return <Suspense fallback={<main className="login-page" aria-busy="true">正在准备登录…</main>}><LoginForm /></Suspense>; }
