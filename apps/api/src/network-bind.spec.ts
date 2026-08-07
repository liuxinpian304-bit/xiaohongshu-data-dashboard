import { describe, expect, it } from 'vitest';

import { apiListenHost } from './network-bind';

describe('API network binding', () => {
  it('always binds the internal API to IPv4 loopback', () => {
    expect(apiListenHost({})).toBe('127.0.0.1');
    expect(apiListenHost({ API_HOST: '127.0.0.1' })).toBe('127.0.0.1');
    expect(() => apiListenHost({ API_HOST: '0.0.0.0' })).toThrow('api_loopback_required');
  });
});
