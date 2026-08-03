import { describe, expect, it } from 'vitest';
import { webCsrfCookie } from '../../../../lib/bff';

describe('login BFF cookie', () => {
  it('keeps the upstream csrf token in a strict HttpOnly cookie', () => {
    expect(webCsrfCookie('token', true)).toEqual(expect.objectContaining({ name: 'web_csrf', value: 'token', httpOnly: true, secure: true, sameSite: 'strict', path: '/' }));
  });
});
