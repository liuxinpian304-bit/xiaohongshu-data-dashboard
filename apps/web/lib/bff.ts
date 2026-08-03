import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const apiBase = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const appOrigin = process.env.APP_ORIGIN ?? 'http://127.0.0.1';
export function webCsrfCookie(value: string, secure: boolean) { return { name: 'web_csrf', value, httpOnly: true, secure, sameSite: 'strict' as const, path: '/' }; }
export class BffRequestError extends Error { constructor(public status:number,message:string){super(message)} }
export async function readBoundedJson(request:Request,maxBytes:number,allowed:string[]){const type=request.headers.get('content-type')?.split(';')[0].trim();if(type!=='application/json')throw new BffRequestError(415,'application/json required');const declared=Number(request.headers.get('content-length')??0);if(declared>maxBytes)throw new BffRequestError(413,'request too large');const reader=request.body?.getReader();let total=0;const chunks:Uint8Array[]=[];if(reader)for(;;){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes)throw new BffRequestError(413,'request too large');chunks.push(value)}const text=new TextDecoder().decode(Buffer.concat(chunks));let value:unknown;try{value=text?JSON.parse(text):{}}catch{throw new BffRequestError(400,'invalid json')}if(!value||typeof value!=='object'||Array.isArray(value))throw new BffRequestError(400,'object required');if(Object.keys(value).some(k=>!allowed.includes(k)))throw new BffRequestError(400,'unknown field');return value as Record<string,unknown>}
export function parseAdminSession(setCookies:string[]){if(setCookies.length!==1)throw new Error('unexpected upstream cookies');const first=setCookies[0]!.split(';')[0]!;const match=/^admin_session=([A-Za-z0-9_-]{20,512})$/.exec(first);if(!match)throw new Error('invalid admin session cookie');return match[1]!}
export function splitCombinedSetCookie(value:string){return value.split(/,(?=\s*[A-Za-z_][A-Za-z0-9_]*=)/).map(v=>v.trim())}
export function parseLoginCookies(values:string[]){const expanded=values.flatMap(splitCombinedSetCookie);const admin=expanded.filter(v=>v.startsWith('admin_session='));const cleared=expanded.filter(v=>v.startsWith('pre_auth_csrf='));if(expanded.length!==admin.length+cleared.length||cleared.length>1)throw new Error('unexpected upstream cookies');if(cleared[0]&&!/^pre_auth_csrf=;.*(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(cleared[0]))throw new Error('pre auth cookie was not cleared');return parseAdminSession(admin)}
function validateDto(path:string,value:Record<string,unknown>){const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;const str=(key:string,max:number,optional=false)=>{const v=value[key];if(v===undefined&&optional)return;if(typeof v!=='string'||v.length<1||v.length>max)throw new BffRequestError(400,`invalid ${key}`)};if(path==='/jobs'&&!uuid.test(String(value.accountId??'')))throw new BffRequestError(400,'invalid accountId');if(path==='/accounts/authorize'){str('connectorType',50);if(value.connectorType!=='mock')throw new BffRequestError(400,'connector not available');str('platformId',200);str('displayName',200,true);str('secret',10_000);str('kind',50)}if(path.endsWith('/reauthorize')){str('secret',10_000);str('kind',50)}if(path.startsWith('/accounts/')&&!path.endsWith('/deactivate')&&!path.endsWith('/reauthorize')&&typeof value.retainData!=='boolean')throw new BffRequestError(400,'invalid retainData')}

export function validateMutationRequest(request: Request, allowedOrigin = appOrigin) {
  if (request.headers.get('origin') !== allowedOrigin) throw new Error('origin rejected');
  const site = request.headers.get('sec-fetch-site');
  if (site !== 'same-origin') throw new Error('fetch metadata rejected');
}
export function mutationHeaders(session: string, csrf: string, origin = appOrigin) {
  return { 'content-type': 'application/json', cookie: `admin_session=${session}`, 'x-csrf-token': csrf, origin, 'sec-fetch-site': 'same-origin' };
}
export async function forwardMutation(request: Request, path: string, method: 'POST'|'PATCH'|'DELETE' = 'POST', allowedFields:string[] = [], maxBytes=16_384) {
  try { validateMutationRequest(request); } catch { return NextResponse.json({ error: '请求来源不可信' }, { status: 403 }); }
  const store = await cookies(); const session = store.get('admin_session')?.value; const csrf = store.get('web_csrf')?.value;
  if (!session || !csrf) return NextResponse.json({ error: '登录已失效' }, { status: 401 });
  let value:Record<string,unknown>;try{value=await readBoundedJson(request,maxBytes,allowedFields);validateDto(path,value)}catch(error){const status=error instanceof BffRequestError?error.status:400;return NextResponse.json({error:error instanceof Error?error.message:'invalid request'},{status})}
  const upstream = await fetch(`${apiBase}${path}`, { method, headers: mutationHeaders(session, csrf), body: JSON.stringify(value) });
  const payload = await upstream.text(); return new NextResponse(payload || null, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' } });
}
export async function authenticatedGet(path: string) {
  const store = await cookies(); const session = store.get('admin_session')?.value;
  if (!session) return NextResponse.json({ error: '登录已失效' }, { status: 401 });
  return fetch(`${apiBase}${path}`, { headers: { cookie: `admin_session=${session}` }, cache: 'no-store' });
}
