import { NextResponse } from 'next/server';
const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1';
export async function POST(request: Request) {
  const csrf = await fetch(`${base}/auth/csrf`, { headers: { origin, 'sec-fetch-site': 'same-origin' } });
  if (!csrf.ok) return NextResponse.json({ error: 'login unavailable' }, { status: 503 });
  const { csrfToken } = await csrf.json() as { csrfToken: string }; const preAuth = csrf.headers.get('set-cookie')?.split(';')[0] ?? '';
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin', 'x-csrf-token': csrfToken, cookie: preAuth }, body: await request.text() });
  const response = NextResponse.json(login.ok ? { ok: true } : { error: 'invalid login' }, { status: login.status });
  const session = login.headers.get('set-cookie'); if (session) response.headers.append('set-cookie', session); return response;
}
