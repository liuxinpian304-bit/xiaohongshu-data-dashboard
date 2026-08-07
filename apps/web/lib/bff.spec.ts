import { describe, expect, it } from 'vitest';
import { cookieSecureForOrigin, mutationHeaders, parseAdminSession, parseLoginCookies, readBoundedJson, validateMutationRequest } from './bff';

describe('mutation BFF boundary', () => {
  it('uses Secure cookies only when the configured dashboard origin is HTTPS', () => {
    expect(cookieSecureForOrigin('http://127.0.0.1:3000')).toBe(false);
    expect(cookieSecureForOrigin('https://dashboard.example.com')).toBe(true);
  });
  it('accepts the default local dashboard origin including its port', () => {
    expect(() => validateMutationRequest(new Request('http://127.0.0.1:3000/api/control/local-collector/sync', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' },
    }))).not.toThrow();
  });
  it('accepts and forwards an explicitly configured LAN origin', () => {
    const previous = process.env.APP_ORIGINS;
    process.env.APP_ORIGINS = 'http://127.0.0.1:3000,http://192.168.0.7:3000';
    try {
      const request = new Request('http://192.168.0.7:3000/api/jobs', { method: 'POST', headers: { origin: 'http://192.168.0.7:3000', 'sec-fetch-site': 'same-origin' } });
      const origin = validateMutationRequest(request);
      expect(origin).toBe('http://192.168.0.7:3000');
      expect(mutationHeaders('session-value', 'csrf-value', origin).origin).toBe('http://192.168.0.7:3000');
    } finally {
      if (previous === undefined) delete process.env.APP_ORIGINS; else process.env.APP_ORIGINS = previous;
    }
  });
  it('accepts an allowed same-origin request when mobile Safari omits fetch metadata', () => {
    const previous = process.env.APP_ORIGINS;
    process.env.APP_ORIGINS = 'http://127.0.0.1:3000,http://192.168.0.7:3000';
    try {
      const request = new Request('http://192.168.0.7:3000/api/session/login', {
        method: 'POST',
        headers: { origin: 'http://192.168.0.7:3000' },
      });
      expect(validateMutationRequest(request)).toBe('http://192.168.0.7:3000');
    } finally {
      if (previous === undefined) delete process.env.APP_ORIGINS; else process.env.APP_ORIGINS = previous;
    }
  });
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
