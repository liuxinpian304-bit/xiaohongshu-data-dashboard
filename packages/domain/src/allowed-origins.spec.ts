import { describe, expect, it } from 'vitest';

import { allowedOrigins, primaryAllowedOrigin, requireAllowedOrigin } from './allowed-origins';

describe('allowed application origins', () => {
  const environment = { APP_ORIGINS: 'http://127.0.0.1:3000,http://192.168.0.7:3000' };

  it('accepts configured local and LAN origins in stable order', () => {
    expect([...allowedOrigins(environment)]).toEqual(['http://127.0.0.1:3000', 'http://192.168.0.7:3000']);
    expect(requireAllowedOrigin('http://192.168.0.7:3000', environment)).toBe('http://192.168.0.7:3000');
    expect(primaryAllowedOrigin(environment)).toBe('http://127.0.0.1:3000');
  });

  it('deduplicates normalized origins and supports the legacy single value', () => {
    expect([...allowedOrigins({ APP_ORIGINS: 'http://127.0.0.1:3000/, http://127.0.0.1:3000' })]).toEqual(['http://127.0.0.1:3000']);
    expect([...allowedOrigins({ APP_ORIGIN: 'http://192.168.0.7:3000' })]).toEqual(['http://192.168.0.7:3000']);
  });

  it('rejects unknown origins and malformed configured values', () => {
    expect(() => requireAllowedOrigin('http://192.168.0.8:3000', environment)).toThrow('origin rejected');
    for (const invalid of ['not-a-url', 'ftp://192.168.0.7:3000', 'http://user:pass@192.168.0.7:3000', 'http://192.168.0.7:3000/path', 'http://192.168.0.7:3000?q=1']) {
      expect(() => allowedOrigins({ APP_ORIGINS: invalid })).toThrow('invalid application origin');
    }
  });

  it('falls back to the local dashboard when configuration is empty', () => {
    expect([...allowedOrigins({ APP_ORIGINS: ' , ' })]).toEqual(['http://127.0.0.1:3000']);
  });
});
