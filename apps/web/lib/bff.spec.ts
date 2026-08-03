import { describe, expect, it } from 'vitest';
import { mutationHeaders, parseAdminSession, parseLoginCookies, readBoundedJson, validateMutationRequest } from './bff';

describe('mutation BFF boundary', () => {
  it('rejects cross-origin and cross-site mutation requests', () => {
    expect(() => validateMutationRequest(new Request('http://127.0.0.1/api/jobs', { method: 'POST', headers: { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' } }), 'http://127.0.0.1')).toThrow('origin rejected');
  });
  it('rejects oversized, non-json and unknown request fields', async () => {
    await expect(readBoundedJson(new Request('http://x',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'}),16,['id'])).rejects.toMatchObject({status:415});
    await expect(readBoundedJson(new Request('http://x',{method:'POST',headers:{'content-type':'application/json','content-length':'99'},body:'{}'}),16,['id'])).rejects.toMatchObject({status:413});
    await expect(readBoundedJson(new Request('http://x',{method:'POST',headers:{'content-type':'application/json'},body:'{"extra":1}'}),16,['id'])).rejects.toMatchObject({status:400});
  });
  it('accepts exactly one well-formed admin session cookie', () => {
    expect(parseAdminSession(['admin_session=abcdefghijklmnopqrstuv; HttpOnly; Path=/'])).toBe('abcdefghijklmnopqrstuv');
    expect(()=>parseAdminSession(['admin_session=abcdefghijklmnopqrstuv','other=x'])).toThrow();
    expect(()=>parseAdminSession(['admin_session=bad value'])).toThrow();
  });
  it('accepts one session plus the expected pre-auth deletion including combined Expires commas',()=>{expect(parseLoginCookies(['admin_session=abcdefghijklmnopqrstuv; HttpOnly; Path=/, pre_auth_csrf=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/auth'])).toBe('abcdefghijklmnopqrstuv');expect(()=>parseLoginCookies(['admin_session=abcdefghijklmnopqrstuv','admin_session=zyxwvutsrqponmlkjihgfe'])).toThrow();});
  it('forwards session and csrf only in server-side headers', () => {
    expect(mutationHeaders('session-value', 'csrf-value', 'http://127.0.0.1')).toMatchObject({ cookie: 'admin_session=session-value', 'x-csrf-token': 'csrf-value', origin: 'http://127.0.0.1', 'sec-fetch-site': 'same-origin' });
  });
});
