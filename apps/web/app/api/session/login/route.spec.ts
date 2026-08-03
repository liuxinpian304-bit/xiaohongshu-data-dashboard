import { describe, expect, it } from 'vitest';
import { webCsrfCookie } from '../../../../lib/bff';
import { POST } from './route';

describe('login BFF cookie', () => {
  it('keeps the upstream csrf token in a strict HttpOnly cookie', () => {
    expect(webCsrfCookie('token', true)).toEqual(expect.objectContaining({ name: 'web_csrf', value: 'token', httpOnly: true, secure: true, sameSite: 'strict', path: '/' }));
  });
  it('rejects cross-site login before contacting upstream', async () => {
    const response = await POST(new Request('http://127.0.0.1/api/session/login',{method:'POST',headers:{origin:'https://evil.test','sec-fetch-site':'cross-site','content-type':'application/json'},body:'{"password":"x"}'}));
    expect(response.status).toBe(403);
  });
});
