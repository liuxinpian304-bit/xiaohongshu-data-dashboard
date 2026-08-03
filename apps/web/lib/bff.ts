import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const apiBase = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const appOrigin = process.env.APP_ORIGIN ?? 'http://127.0.0.1';
export function webCsrfCookie(value: string, secure: boolean) { return { name: 'web_csrf', value, httpOnly: true, secure, sameSite: 'strict' as const, path: '/' }; }

export function validateMutationRequest(request: Request, allowedOrigin = appOrigin) {
  if (request.headers.get('origin') !== allowedOrigin) throw new Error('origin rejected');
  const site = request.headers.get('sec-fetch-site');
  if (site !== 'same-origin') throw new Error('fetch metadata rejected');
}
export function mutationHeaders(session: string, csrf: string, origin = appOrigin) {
  return { 'content-type': 'application/json', cookie: `admin_session=${session}`, 'x-csrf-token': csrf, origin, 'sec-fetch-site': 'same-origin' };
}
export async function forwardMutation(request: Request, path: string, method: 'POST'|'PATCH'|'DELETE' = 'POST') {
  try { validateMutationRequest(request); } catch { return NextResponse.json({ error: '请求来源不可信' }, { status: 403 }); }
  const store = await cookies(); const session = store.get('admin_session')?.value; const csrf = store.get('web_csrf')?.value;
  if (!session || !csrf) return NextResponse.json({ error: '登录已失效' }, { status: 401 });
  const body = method === 'PATCH' && request.headers.get('content-length') === '0' ? undefined : await request.text();
  const upstream = await fetch(`${apiBase}${path}`, { method, headers: mutationHeaders(session, csrf), body: body || undefined });
  const payload = await upstream.text(); return new NextResponse(payload || null, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' } });
}
export async function authenticatedGet(path: string) {
  const store = await cookies(); const session = store.get('admin_session')?.value;
  if (!session) return NextResponse.json({ error: '登录已失效' }, { status: 401 });
  return fetch(`${apiBase}${path}`, { headers: { cookie: `admin_session=${session}` }, cache: 'no-store' });
}
