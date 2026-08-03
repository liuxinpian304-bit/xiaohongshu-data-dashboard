import { NextResponse } from 'next/server';
import { BffRequestError, parseLoginCookies, readBoundedJson, validateMutationRequest, webCsrfCookie } from '../../../../lib/bff';
const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1';
export async function POST(request: Request) {
  try { validateMutationRequest(request); } catch { return NextResponse.json({error:'request origin rejected'},{status:403}); }
  let input:Record<string,unknown>;try{input=await readBoundedJson(request,2048,['password']);if(typeof input.password!=='string'||input.password.length<1||input.password.length>1024)throw new BffRequestError(400,'invalid password');}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'invalid request'},{status:error instanceof BffRequestError?error.status:400});}
  const csrf = await fetch(`${base}/auth/csrf`, { headers: { origin, 'sec-fetch-site': 'same-origin' } });
  if (!csrf.ok) return NextResponse.json({ error: 'login unavailable' }, { status: 503 });
  const { csrfToken } = await csrf.json() as { csrfToken: string }; const preAuth = csrf.headers.get('set-cookie')?.split(';')[0] ?? '';
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin', 'x-csrf-token': csrfToken, cookie: preAuth }, body: JSON.stringify(input) });
  const result = await login.json().catch(() => null) as { csrfToken?: string; expiresIn?: number } | null;
  const response = NextResponse.json(login.ok ? { ok: true } : { error: 'invalid login' }, { status: login.status });
  if(login.ok){try{if(!Number.isInteger(result?.expiresIn)||result?.expiresIn!==1800)throw new Error('invalid session lifetime');const values=(login.headers as Headers&{getSetCookie?:()=>string[]}).getSetCookie?.()??(login.headers.get('set-cookie')?[login.headers.get('set-cookie')!]:[]);response.cookies.set({name:'admin_session',value:parseLoginCookies(values),httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:result.expiresIn});}catch{return NextResponse.json({error:'invalid upstream session'},{status:502})}}
  if (login.ok && result?.csrfToken) response.cookies.set(webCsrfCookie(result.csrfToken, process.env.NODE_ENV === 'production'));
  return response;
}
